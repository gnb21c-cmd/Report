/* 비밀번호 걸린 엑셀(.xlsx) 풀기 — 나이스 '통합거래조회' 는 내려받을 때 비밀번호를 꼭 넣어야 함
   엑셀 표준 암호(ECMA-376 Agile: AES-CBC + SHA 해시 반복) 를 브라우저 WebCrypto 로 풂. 비밀번호는 저장하지 않음 */
import * as XLSX from "xlsx";

// Node(자동 수집)에서는 CFB 가 default 쪽에만 있음
const CFB: typeof XLSX.CFB = (XLSX as any).CFB ?? (XLSX as any).default?.CFB;

const te = new TextEncoder();

const HASH: Record<string, string> = { SHA1: "SHA-1", "SHA-1": "SHA-1", SHA256: "SHA-256", SHA384: "SHA-384", SHA512: "SHA-512" };

function concat(...xs: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(xs.reduce((s, x) => s + x.length, 0));
  let o = 0;
  for (const x of xs) {
    out.set(x, o);
    o += x.length;
  }
  return out;
}
const le32 = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const utf16 = (s: string) => {
  const b = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    b[i * 2] = s.charCodeAt(i) & 255;
    b[i * 2 + 1] = s.charCodeAt(i) >>> 8;
  }
  return b;
};

async function digest(alg: string, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest(alg, data as BufferSource));
}

/** SHA-1 (바로 계산) — 비밀번호 해시를 10만 번 되풀이할 때 WebCrypto 를 매번 부르면 느려서 */
function sha1(msg: Uint8Array): Uint8Array {
  const ml = msg.length;
  const len = (((ml + 8) >> 6) + 1) << 6;
  const b = new Uint8Array(len);
  b.set(msg);
  b[ml] = 0x80;
  const dv = new DataView(b.buffer);
  dv.setUint32(len - 4, ml * 8);
  dv.setUint32(len - 8, Math.floor((ml * 8) / 2 ** 32));
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Int32Array(80);
  for (let o = 0; o < len; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getInt32(o + i * 4);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0, bb = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (bb & c) | (~bb & d) : i < 40 ? bb ^ c ^ d : i < 60 ? (bb & c) | (bb & d) | (c & d) : bb ^ c ^ d;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = (bb << 30) | (bb >>> 2);
      bb = a;
      a = t;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + bb) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }
  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => ov.setInt32(i * 4, h));
  return out;
}

/** 길이 맞추기 — 짧으면 0x36 으로 채움 */
const fit = (b: Uint8Array, n: number) => (b.length >= n ? b.slice(0, n) : concat(b, new Uint8Array(n - b.length).fill(0x36)));

/** AES-CBC 풀기 (덧붙임 없음) — WebCrypto 는 PKCS7 덧붙임을 요구하므로 맞는 덧붙임 블록을 하나 만들어 붙임 */
async function aesCbcRaw(keyBytes: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", keyBytes as BufferSource, "AES-CBC", false, ["encrypt", "decrypt"]);
  const last = data.slice(data.length - 16);
  const pad = new Uint8Array(16).fill(16).map((v, i) => v ^ last[i]);
  const extra = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: new Uint8Array(16) }, key, pad as BufferSource)).slice(0, 16);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: iv as BufferSource }, key, concat(data, extra) as BufferSource));
}

const attr = (xml: string, tag: string, name: string) => {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*\\b${name}="([^"]*)"`));
  return m ? m[1] : "";
};

/** 비밀번호 걸린 파일인지 (암호 묶음 = OLE 파일 안에 EncryptedPackage) */
export function isEncrypted(buf: ArrayBuffer): boolean {
  const b = new Uint8Array(buf);
  if (!(b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0)) return false;
  try {
    const cfb = CFB.read(b, { type: "array" });
    return !!CFB.find(cfb, "EncryptedPackage");
  } catch {
    return false;
  }
}

/** 풀기 — 비밀번호가 틀리면 오류 */
export async function decryptXlsx(buf: ArrayBuffer, password: string): Promise<ArrayBuffer> {
  const cfb = CFB.read(new Uint8Array(buf), { type: "array" });
  const info = CFB.find(cfb, "EncryptionInfo");
  const pkg = CFB.find(cfb, "EncryptedPackage");
  if (!info || !pkg) throw new Error("비밀번호 걸린 엑셀이 아닙니다.");
  const infoBytes = new Uint8Array(info.content as any);
  const ver = infoBytes[0] | (infoBytes[1] << 8);
  const minor = infoBytes[2] | (infoBytes[3] << 8);
  if (ver !== 4 || minor !== 4) throw new Error("이 엑셀 암호 방식은 아직 못 엽니다. 엑셀에서 비밀번호를 지우고 다시 저장해 주세요.");
  const xml = new TextDecoder().decode(infoBytes.slice(8));
  // 파일 열쇠를 감싼 값 (비밀번호로 만든 열쇠로 풂)
  const kAlg = HASH[attr(xml, "encryptedKey", "hashAlgorithm")] || "SHA-1";
  const kSalt = b64(attr(xml, "encryptedKey", "saltValue"));
  const spin = Number(attr(xml, "encryptedKey", "spinCount")) || 100000;
  const kBits = Number(attr(xml, "encryptedKey", "keyBits")) || 128;
  const encKey = b64(attr(xml, "encryptedKey", "encryptedKeyValue"));
  let h = await digest(kAlg, concat(kSalt, utf16(password)));
  if (kAlg === "SHA-1") for (let i = 0; i < spin; i++) h = sha1(concat(le32(i), h));
  else for (let i = 0; i < spin; i++) h = await digest(kAlg, concat(le32(i), h));
  const blockKey = new Uint8Array([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]);
  const pwKey = fit(await digest(kAlg, concat(h, blockKey)), kBits / 8);
  let secret: Uint8Array;
  try {
    secret = (await aesCbcRaw(pwKey, kSalt, encKey)).slice(0, kBits / 8);
  } catch {
    throw new Error("비밀번호가 맞지 않습니다.");
  }
  // 본문 — 4096 바이트씩, 칸마다 IV = 해시(묶음 소금 + 칸 번호)
  const dAlg = HASH[attr(xml, "keyData", "hashAlgorithm")] || "SHA-1";
  const dSalt = b64(attr(xml, "keyData", "saltValue"));
  const block = Number(attr(xml, "keyData", "blockSize")) || 16;
  const enc = new Uint8Array(pkg.content as any);
  const size = enc[0] + enc[1] * 2 ** 8 + enc[2] * 2 ** 16 + enc[3] * 2 ** 24 + (enc[4] + enc[5] * 2 ** 8) * 2 ** 32;
  const body = enc.slice(8);
  const parts: Uint8Array[] = [];
  for (let i = 0, off = 0; off < body.length; i++, off += 4096) {
    const seg = body.slice(off, Math.min(off + 4096, body.length));
    const iv = fit(await digest(dAlg, concat(dSalt, le32(i))), block);
    try {
      parts.push(await aesCbcRaw(secret, iv, seg.slice(0, seg.length - (seg.length % 16))));
    } catch {
      throw new Error("비밀번호가 맞지 않습니다.");
    }
  }
  const out = concat(...parts).slice(0, size);
  // 풀린 파일은 zip(PK) 이어야 함
  if (!(out[0] === 0x50 && out[1] === 0x4b)) throw new Error("비밀번호가 맞지 않습니다.");
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}
