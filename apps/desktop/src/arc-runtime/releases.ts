import { valid } from "semver";
import type { ArcRuntimeId } from "./types.js";

export type ArcRuntimeArtifactKind = "archive" | "executable";

export interface ArcRuntimeRelease {
  runtimeId: ArcRuntimeId;
  artifactKind: ArcRuntimeArtifactKind;
  version: string;
  platform: string;
  releaseTag: string;
  assetName: string;
  downloadUrl: string;
  sha256: string;
  executableSha256: string;
  expectedExecutableVersion: string;
  license: string;
}

const TRUSTED_RELEASE_DOWNLOAD_ORIGIN = "https://github.com";
const TRUSTED_RELEASE_DOWNLOAD_HOST = "github.com";

const TRUSTED_RELEASE_DOWNLOAD_PATH_PREFIXES: Partial<
  Record<ArcRuntimeId, string>
> = {
  codex: "/openai/codex/releases/download/",
  omp: "/can1357/oh-my-pi/releases/download/",
};

export const ARC_CODEX_RELEASE: ArcRuntimeRelease = {
  runtimeId: "codex",
  artifactKind: "archive",
  version: "0.155.1",
  platform: "darwin-arm64",
  releaseTag: "rust-v0.155.1",
  assetName: "codex-aarch64-apple-darwin.tar.gz",
  downloadUrl:
    "https://github.com/openai/codex/releases/download/rust-v0.155.1/codex-aarch64-apple-darwin.tar.gz",
  sha256:
    "5e5a51470dce2423f9d96bd191d0bbc4cc0e2848a6833df5178eaf47a07a3768",
  executableSha256:
    "8eaf1ad12fe6bf89b1710330f58900014322c7c5af677e43be116d8ac5fc0a9e",
  expectedExecutableVersion: "0.155.1",
  license: "Apache-2.0",
};

export const ARC_OMP_RELEASE: ArcRuntimeRelease = {
  runtimeId: "omp",
  artifactKind: "executable",
  version: "18.2.6",
  platform: "darwin-arm64",
  releaseTag: "v18.2.6",
  assetName: "omp-darwin-arm64",
  downloadUrl:
    "https://github.com/can1357/oh-my-pi/releases/download/v18.2.6/omp-darwin-arm64",
  sha256:
    "d498da40d577e1ffa681ca8632c2ea40a9f722a08b880412011d37dffee9513a",
  executableSha256:
    "d498da40d577e1ffa681ca8632c2ea40a9f722a08b880412011d37dffee9513a",
  expectedExecutableVersion: "18.2.6",
  license: "MIT",
};

export const ARC_RUNTIME_RELEASES: readonly ArcRuntimeRelease[] = [
  ARC_CODEX_RELEASE,
  ARC_OMP_RELEASE,
];

export type ArcRuntimeReleaseValidation =
  | { kind: "ok" }
  | { kind: "invalid"; problem: string };

function isHexDigest(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

export function validateArcRuntimeRelease(
  release: ArcRuntimeRelease,
): ArcRuntimeReleaseValidation {
  if (valid(release.version) === null) {
    return {
      kind: "invalid",
      problem: `release version "${release.version}" is not valid semver`,
    };
  }
  if (valid(release.expectedExecutableVersion) === null) {
    return {
      kind: "invalid",
      problem: `expected executable version "${release.expectedExecutableVersion}" is not valid semver`,
    };
  }
  if (release.releaseTag.includes("latest")) {
    return {
      kind: "invalid",
      problem: `release tag "${release.releaseTag}" must not reference a moving target`,
    };
  }
  if (!isHexDigest(release.sha256)) {
    return {
      kind: "invalid",
      problem: "sha256 must be a lowercase 64-character hex digest",
    };
  }
  if (!isHexDigest(release.executableSha256)) {
    return {
      kind: "invalid",
      problem: "executableSha256 must be a lowercase 64-character hex digest",
    };
  }
  if (release.artifactKind !== "archive" && release.artifactKind !== "executable") {
    return {
      kind: "invalid",
      problem: `artifactKind "${String(release.artifactKind)}" is not supported`,
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(release.downloadUrl);
  } catch {
    return { kind: "invalid", problem: "downloadUrl is not a valid URL" };
  }
  if (parsed.protocol !== "https:") {
    return {
      kind: "invalid",
      problem: `downloadUrl must use https, got ${parsed.protocol}`,
    };
  }
  const trustedPathPrefix =
    TRUSTED_RELEASE_DOWNLOAD_PATH_PREFIXES[release.runtimeId];
  if (trustedPathPrefix === undefined) {
    return {
      kind: "invalid",
      problem: `no trusted download origin is recorded for runtime "${release.runtimeId}"`,
    };
  }
  if (
    parsed.host !== TRUSTED_RELEASE_DOWNLOAD_HOST ||
    !parsed.pathname.startsWith(trustedPathPrefix)
  ) {
    return {
      kind: "invalid",
      problem: `downloadUrl must be a ${TRUSTED_RELEASE_DOWNLOAD_ORIGIN} release asset under ${trustedPathPrefix}`,
    };
  }
  if (!parsed.pathname.endsWith(`/${release.assetName}`)) {
    return {
      kind: "invalid",
      problem: "downloadUrl must end with the exact pinned asset name",
    };
  }
  if (
    release.downloadUrl.includes("latest") ||
    release.assetName.includes("latest")
  ) {
    return {
      kind: "invalid",
      problem: "release identity must never use a latest alias",
    };
  }
  if (
    release.artifactKind === "archive" &&
    !release.assetName.endsWith(".tar.gz")
  ) {
    return {
      kind: "invalid",
      problem: 'archive artifacts must use the ".tar.gz" extension',
    };
  }
  if (
    release.artifactKind === "executable" &&
    release.sha256 !== release.executableSha256
  ) {
    return {
      kind: "invalid",
      problem:
        "executable artifacts are staged directly, so sha256 and executableSha256 must be identical",
    };
  }
  return { kind: "ok" };
}
