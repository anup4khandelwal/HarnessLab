import type { JsonObject, JsonValue } from "../common";

export interface JsonSchema {
  additionalProperties?: boolean;
  enum?: JsonValue[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  type: "array" | "boolean" | "number" | "object" | "string";
}

export interface ValidationResult {
  errors: string[];
  valid: boolean;
}

export const validateAgainstSchema = (value: JsonValue, schema: JsonSchema, path = "$"): ValidationResult => {
  const errors: string[] = [];

  if (schema.enum !== undefined && !schema.enum.some((candidate) => candidate === value)) {
    errors.push(`${path} must match one of the enum values`);
  }

  switch (schema.type) {
    case "string":
      if (typeof value !== "string") {
        errors.push(`${path} must be a string`);
      }
      break;
    case "number":
      if (typeof value !== "number") {
        errors.push(`${path} must be a number`);
      }
      break;
    case "boolean":
      if (typeof value !== "boolean") {
        errors.push(`${path} must be a boolean`);
      }
      break;
    case "array":
      if (!Array.isArray(value)) {
        errors.push(`${path} must be an array`);
      } else if (schema.items !== undefined) {
        value.forEach((item, index) => {
          const nested = validateAgainstSchema(item, schema.items!, `${path}[${index}]`);
          errors.push(...nested.errors);
        });
      }
      break;
    case "object":
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        errors.push(`${path} must be an object`);
        break;
      }

      validateObject(value, schema, path, errors);
      break;
  }

  return {
    errors,
    valid: errors.length === 0
  };
};

const validateObject = (
  value: JsonObject,
  schema: JsonSchema,
  path: string,
  errors: string[]
): void => {
  const properties = schema.properties ?? {};

  for (const key of schema.required ?? []) {
    if (!(key in value)) {
      errors.push(`${path}.${key} is required`);
    }
  }

  for (const [key, propertySchema] of Object.entries(properties)) {
    const propertyValue = value[key];

    if (propertyValue === undefined) {
      continue;
    }

    const nested = validateAgainstSchema(propertyValue, propertySchema, `${path}.${key}`);
    errors.push(...nested.errors);
  }

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!(key in properties)) {
        errors.push(`${path}.${key} is not allowed`);
      }
    }
  }
};

