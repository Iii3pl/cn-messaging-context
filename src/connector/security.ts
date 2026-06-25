import crypto from "node:crypto";
import type { Request } from "express";

export function rawBodySaver(req: Request, _res: unknown, buffer: Buffer): void {
  (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
}

export function verifyOptionalHmacSignature(req: Request, secret: string | undefined, headerNames: string[]): boolean {
  if (!secret) {
    return true;
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    return false;
  }

  const supplied = headerNames
    .map((headerName) => req.header(headerName))
    .find((value): value is string => Boolean(value));

  if (!supplied) {
    return false;
  }

  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  const hexDigest = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeEqual(supplied, digest) || timingSafeEqual(supplied, hexDigest);
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
