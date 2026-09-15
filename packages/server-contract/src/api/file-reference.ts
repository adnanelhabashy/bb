import { z } from "zod";

const FILE_REFERENCE_VALUE_MAX_LENGTH = 32_768;
const WINDOWS_DRIVE_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/u;
const WINDOWS_UNC_ABSOLUTE_PATH = /^\\\\/u;

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && codePoint < 0x20) return true;
  }
  return false;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return true;
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function isValidValue(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= FILE_REFERENCE_VALUE_MAX_LENGTH &&
    value.trim() === value &&
    !hasControlCharacter(value) &&
    !hasUnpairedSurrogate(value)
  );
}

function isValidPathSegment(segment: string): boolean {
  return segment.length > 0 && segment !== "." && segment !== "..";
}

function isValidRelativeFilePath(value: string): boolean {
  return (
    isValidValue(value) &&
    !value.includes("\\") &&
    value.split("/").every(isValidPathSegment)
  );
}

function isValidAbsoluteHostFilePath(value: string): boolean {
  if (!isValidValue(value)) return false;

  if (value.startsWith("/") && !value.startsWith("//")) {
    return value.slice(1).split("/").every(isValidPathSegment);
  }

  if (WINDOWS_DRIVE_ABSOLUTE_PATH.test(value)) {
    return value.slice(3).split(/[\\/]/u).every(isValidPathSegment);
  }

  if (WINDOWS_UNC_ABSOLUTE_PATH.test(value)) {
    const segments = value.slice(2).split(/[\\/]/u);
    return segments.length >= 3 && segments.every(isValidPathSegment);
  }

  return false;
}

const fileReferenceIdentitySchema = z.string().refine(isValidValue);
const fileReferenceRelativePathSchema = z
  .string()
  .refine(isValidRelativeFilePath);
const fileReferenceAbsolutePathSchema = z
  .string()
  .refine(isValidAbsoluteHostFilePath);

export const fileReferenceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("workspace"),
      environmentId: fileReferenceIdentitySchema,
      path: fileReferenceRelativePathSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("host"),
      hostId: fileReferenceIdentitySchema,
      path: fileReferenceAbsolutePathSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("thread-storage"),
      threadId: fileReferenceIdentitySchema,
      path: fileReferenceRelativePathSchema,
    })
    .strict(),
]);

export type FileReference = z.infer<typeof fileReferenceSchema>;
