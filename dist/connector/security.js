import crypto from "node:crypto";
export function rawBodySaver(req, _res, buffer) {
    req.rawBody = Buffer.from(buffer);
}
export function verifyOptionalHmacSignature(req, secret, headerNames) {
    if (!secret) {
        return true;
    }
    const rawBody = req.rawBody;
    if (!rawBody) {
        return false;
    }
    const supplied = headerNames
        .map((headerName) => req.header(headerName))
        .find((value) => Boolean(value));
    if (!supplied) {
        return false;
    }
    const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
    const hexDigest = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    return timingSafeEqual(supplied, digest) || timingSafeEqual(supplied, hexDigest);
}
function timingSafeEqual(left, right) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
//# sourceMappingURL=security.js.map