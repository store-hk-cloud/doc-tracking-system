export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export type AllowedImageMimeType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/heic'
  | 'image/heif';

const ALLOWED_IMAGE_MIME_TYPES = new Set<AllowedImageMimeType>([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const);

type ImageValidationResult =
  | { ok: true; mimeType: AllowedImageMimeType }
  | { ok: false; error: string };

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function readUint32(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function asciiAt(bytes: Uint8Array, offset: number) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

/** คืน MIME ของ HEIF ที่ bytes ยืนยันได้ตาม compatible brands ใน ftyp box */
function heifMimeTypes(bytes: Uint8Array): Set<AllowedImageMimeType> {
  if (bytes.length < 16 || asciiAt(bytes, 4) !== 'ftyp') return new Set();

  const declaredLength = readUint32(bytes, 0);
  if (declaredLength < 16 || declaredLength > bytes.length || declaredLength % 4 !== 0) return new Set();

  const brands = new Set<string>([asciiAt(bytes, 8)]);
  for (let offset = 16; offset + 4 <= declaredLength; offset += 4) {
    brands.add(asciiAt(bytes, offset));
  }

  const mimeTypes = new Set<AllowedImageMimeType>();
  // IANA กำหนด image/heic ให้มี compatible brand กลุ่มนี้ ส่วน image/heif ต้องมี mif1
  if (['heic', 'heix', 'heim', 'heis'].some((brand) => brands.has(brand))) {
    mimeTypes.add('image/heic');
  }
  if (brands.has('mif1')) mimeTypes.add('image/heif');
  return mimeTypes;
}

function mimeTypesFromContent(bytes: Uint8Array): Set<AllowedImageMimeType> {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return new Set(['image/jpeg']);
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return new Set(['image/png']);
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return new Set(['image/webp']);
  }
  return heifMimeTypes(bytes);
}

export function validateImageContent(declaredMimeType: string, bytes: Uint8Array): ImageValidationResult {
  const mimeType = declaredMimeType.split(';', 1)[0].trim().toLowerCase() as AllowedImageMimeType;
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    return { ok: false, error: 'อัปโหลดได้เฉพาะไฟล์รูปภาพ (JPEG, PNG, WebP, HEIC)' };
  }

  const actualMimeTypes = mimeTypesFromContent(bytes);
  if (actualMimeTypes.size === 0) {
    return { ok: false, error: 'อัปโหลดได้เฉพาะไฟล์รูปภาพ (JPEG, PNG, WebP, HEIC)' };
  }
  if (!actualMimeTypes.has(mimeType)) {
    return { ok: false, error: 'ชนิดไฟล์ไม่ตรงกับเนื้อหาไฟล์รูป' };
  }
  return { ok: true, mimeType };
}

export function imageFileExtension(mimeType: AllowedImageMimeType): string {
  switch (mimeType) {
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/heic': return 'heic';
    case 'image/heif': return 'heif';
    default: return 'jpg';
  }
}
