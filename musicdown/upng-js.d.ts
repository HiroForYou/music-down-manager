declare module 'upng-js' {
  interface UpngImage {
    width: number;
    height: number;
  }
  const UPNG: {
    decode(buffer: ArrayBuffer): UpngImage;
    toRGBA8(image: UpngImage): ArrayBuffer[];
  };
  export default UPNG;
}
