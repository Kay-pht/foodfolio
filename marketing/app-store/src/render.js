import { slides } from "./slides.js";

const params = new URLSearchParams(window.location.search);
const slideId = params.get("slide") ?? slides[0].id;
const slide = slides.find((candidate) => candidate.id === slideId) ?? slides[0];

const artboard = document.querySelector("#artboard");
const kicker = document.querySelector("#kicker");
const title = document.querySelector("#title");
const visual = document.querySelector("#visual");

artboard.dataset.layout = slide.layout;
artboard.dataset.theme = slide.theme ?? "coral";
artboard.style.setProperty("--tilt", `${slide.tilt ?? 0}deg`);
kicker.textContent = slide.kicker;

slide.title.forEach((line, index) => {
  if (index > 0) title.append(document.createElement("br"));
  title.append(document.createTextNode(line));
});

const annotationsByScreen = new Map();
for (const annotation of slide.annotations ?? []) {
  const list = annotationsByScreen.get(annotation.screen) ?? [];
  list.push(annotation);
  annotationsByScreen.set(annotation.screen, list);
}

const images = slide.images.map((src, index) => {
  const frame = document.createElement("figure");
  frame.className = `screen screen--${index + 1}`;

  const image = document.createElement("img");
  image.src = src;
  image.alt = `Foodfolioアプリ画面 ${index + 1}`;
  image.decoding = "sync";
  frame.append(image);

  const label = slide.labels?.[index];
  if (label) {
    const labelElement = document.createElement("div");
    labelElement.className = "screen-label";
    labelElement.textContent = label;
    frame.append(labelElement);
  }

  for (const annotation of annotationsByScreen.get(index) ?? []) {
    const element = document.createElement("div");
    element.className = `annotation annotation--${annotation.kind}`;
    element.style.left = `${annotation.x}%`;
    element.style.top = `${annotation.y}%`;

    if (annotation.w != null) element.style.width = `${annotation.w}%`;
    if (annotation.h != null) element.style.height = `${annotation.h}%`;
    if (annotation.arrow) element.dataset.arrow = annotation.arrow;
    if (annotation.text) element.textContent = annotation.text;

    frame.append(element);
  }

  visual.append(frame);
  return image;
});

await Promise.all(
  images.map(async (image) => {
    if (image.complete && image.naturalWidth > 0) return;
    await image.decode();
  }),
);

await document.fonts.ready;
document.documentElement.dataset.ready = "true";
