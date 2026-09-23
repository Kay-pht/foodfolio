import { slides } from "./slides.js";

const params = new URLSearchParams(window.location.search);
const slideId = params.get("slide") ?? slides[0].id;
const slide = slides.find((candidate) => candidate.id === slideId) ?? slides[0];

const artboard = document.querySelector("#artboard");
const eyebrow = document.querySelector("#eyebrow");
const title = document.querySelector("#title");
const body = document.querySelector("#body");
const chips = document.querySelector("#chips");
const visual = document.querySelector("#visual");

artboard.dataset.layout = slide.layout;
eyebrow.textContent = slide.eyebrow;

slide.title.forEach((line, index) => {
  if (index > 0) title.append(document.createElement("br"));
  title.append(document.createTextNode(line));
});

slide.body.forEach((line, index) => {
  if (index > 0) body.append(document.createElement("br"));
  body.append(document.createTextNode(line));
});

for (const chip of slide.chips) {
  const element = document.createElement("span");
  element.className = "chip";
  element.textContent = chip;
  chips.append(element);
}

const images = slide.images.map((src, index) => {
  const frame = document.createElement("figure");
  frame.className = `screen screen--${index + 1}`;

  const image = document.createElement("img");
  image.src = src;
  image.alt = `Foodfolioアプリ画面 ${index + 1}`;
  image.decoding = "sync";

  frame.append(image);
  visual.append(frame);
  return image;
});

await Promise.all(
  images.map(async (image) => {
    if (image.complete) return;
    await image.decode();
  }),
);

await document.fonts.ready;
document.documentElement.dataset.ready = "true";
