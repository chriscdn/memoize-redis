import shajs from "sha.js";
import canonicalize from "canonicalize";
import { isString } from "@chriscdn/type-guards";

const sha256 = (value: string): string =>
  shajs("sha256").update(value).digest("hex");

const canonicalHash = (value: unknown): string => {
  const cValue = canonicalize(value);

  if (isString(cValue)) {
    return sha256(cValue);
  } else {
    throw new TypeError("canonicalHash value is not JSON serializable");
  }
};

export { canonicalize, canonicalHash, sha256 };
