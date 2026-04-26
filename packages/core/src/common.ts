export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export const nowIso = (): string => new Date().toISOString();

export const safeJsonStringify = (value: JsonValue | undefined): string => {
  if (value === undefined) {
    return "undefined";
  }

  return JSON.stringify(value, (_key, candidate) => {
    if (candidate instanceof Error) {
      return {
        message: candidate.message,
        name: candidate.name,
        stack: candidate.stack
      };
    }

    return candidate;
  });
};

export const hashValue = (value: JsonValue | undefined): string => {
  const text = safeJsonStringify(value);
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(index);
    hash |= 0;
  }

  return `${hash}`;
};

export const asJsonObject = (value: JsonValue | undefined): JsonObject => {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }

  return {};
};

