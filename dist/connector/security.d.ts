import type { Request } from "express";
export declare function rawBodySaver(req: Request, _res: unknown, buffer: Buffer): void;
export declare function verifyOptionalHmacSignature(req: Request, secret: string | undefined, headerNames: string[]): boolean;
