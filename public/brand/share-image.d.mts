// Generated from checked TypeScript; edit src/browser or src/publisher.mts. MIT.
export type Raster = {
    width: number;
    height: number;
    format: "image/png" | "image/jpeg" | "image/webp";
};
export declare function imageDimensions(bytes: Uint8Array): Raster;
export declare function validateCardPNG(bytes: Uint8Array): Promise<void>;
