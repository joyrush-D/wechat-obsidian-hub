function readVarint(buf: Uint8Array, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buf.length) {
    const byte = buf[pos];
    result |= (byte & 0x7f) << shift;
    pos++;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 35) break;
  }
  return [result, pos];
}

function readLengthDelimited(buf: Uint8Array, offset: number): [Uint8Array, number] {
  const [length, pos] = readVarint(buf, offset);
  const data = buf.slice(pos, pos + length);
  return [data, pos + length];
}

interface ProtoField {
  fieldNumber: number;
  wireType: number;
  data: Uint8Array | number;
}

function parseProtoFields(buf: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let offset = 0;
  while (offset < buf.length) {
    try {
      const [tag, tagEnd] = readVarint(buf, offset);
      const fieldNumber = tag >> 3;
      const wireType = tag & 0x07;
      if (fieldNumber === 0) break;
      if (wireType === 0) {
        const [value, end] = readVarint(buf, tagEnd);
        fields.push({ fieldNumber, wireType, data: value });
        offset = end;
      } else if (wireType === 2) {
        const [data, end] = readLengthDelimited(buf, tagEnd);
        fields.push({ fieldNumber, wireType, data });
        offset = end;
      } else { break; }
    } catch { break; }
  }
  return fields;
}

export function parseExtBufferNicknames(buffer: Uint8Array | null): Map<string, string> {
  const result = new Map<string, string>();
  if (!buffer || buffer.length === 0) return result;
  try {
    const topFields = parseProtoFields(buffer);
    for (const field of topFields) {
      if (field.fieldNumber === 4 && field.wireType === 2) {
        const memberFields = parseProtoFields(field.data as Uint8Array);
        let wxid = '';
        let nickname = '';
        for (const mf of memberFields) {
          if (mf.fieldNumber === 1 && mf.wireType === 2)
            wxid = new TextDecoder().decode(mf.data as Uint8Array);
          else if (mf.fieldNumber === 2 && mf.wireType === 2)
            nickname = new TextDecoder().decode(mf.data as Uint8Array);
        }
        if (wxid && nickname) result.set(wxid, nickname);
      }
    }
  } catch {}
  return result;
}
