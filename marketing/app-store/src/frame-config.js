export const PORTRAIT_FRAME_NAME = "iPhone 18 Pro - Burgundy - Portrait";

export const PORTRAIT_FRAME_SIZE = Object.freeze({
  width: 1350,
  height: 2760,
});

export function frameArguments(input, bezels, output, name) {
  return [
    input,
    "--frame",
    PORTRAIT_FRAME_NAME,
    "--dir",
    bezels,
    "--out",
    output,
    "--name",
    name,
  ];
}
