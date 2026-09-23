import { slides } from "./slides.js";

const params = new URLSearchParams(window.location.search);
const slideId = params.get("slide") ?? slides[0].id;
const slide = slides.find((candidate) => candidate.id === slideId) ?? slides[0];

const artboard = document.querySelector("#artboard");
const eyebrow = document.querySelector("#eyebrow");
const title = document.querySelector("#title");
const body = document.querySelector("#body");
const chips = document.querySelector("#chips");
const sourceMenu = document.querySelector("#source-menu");
const steps = document.querySelector("#steps");
const visual = document.querySelector("#visual");

artboard.dataset.layout = slide.layout;
artboard.dataset.theme = slide.theme ?? "coral";
artboard.style.setProperty("--tilt", `${slide.tilt ?? 0}deg`);
eyebrow.textContent = slide.eyebrow;

slide.title.forEach((line, index) => {
  if (index > 0) title.append(document.createElement("br"));
  title.append(document.createTextNode(line));
});

slide.body.forEach((line, index) => {
  if (index > 0) body.append(document.createElement("br"));
  body.append(document.createTextNode(line));
});

for (const chip of slide.chips ?? []) {
  const element = document.createElement("span");
  element.className = "chip";
  element.textContent = chip;
  chips.append(element);
}

if (slide.sourceMenu?.length) {
  slide.sourceMenu.forEach((item, index) => {
    const element = document.createElement("span");
    element.className = "source-menu__item";
    if (index === slide.sourceMenu.length - 1) {
      element.classList.add("source-menu__item--destination");
    }
    element.textContent = item;
    sourceMenu.append(element);

    if (index < slide.sourceMenu.length - 1) {
      const arrow = document.createElement("span");
      arrow.className = "source-menu__arrow";
      arrow.textContent = "→";
      sourceMenu.append(arrow);
    }
  });
} else {
  sourceMenu.hidden = true;
}

if (slide.steps?.length) {
  slide.steps.forEach((step, index) => {
    const item = document.createElement("div");
    item.className = "step";

    const number = document.createElement("span");
    number.className = "step__number";
    number.textContent = String(index + 1);

    const label = document.createElement("span");
    label.className = "step__label";
    label.textContent = step;

    item.append(number, label);
    steps.append(item);

    if (index < slide.steps.length - 1) {
      const arrow = document.createElement("span");
      arrow.className = "step__arrow";
      arrow.textContent = "→";
      steps.append(arrow);
    }
  });
} else {
  steps.hidden = true;
}

const annotationsByScreen = new Map();
for (const annotation of slide.annotations ?? []) {
  const list = annotationsByScreen.get(annotation.screen) ?? [];
  list.push(annotation);
  annotationsByScreen.set(annotation.screen, list);
}

const images = slide.images.map((src, index) => {
  const frame = document.createElement("figure");
  frame.className = `screen screen--${index + 1}`;

  const canvas = document.createElement("div");
  canvas.className = "screen__canvas";

  const image = document.createElement("img");
  image.src = src;
  image.alt = `Foodfolioアプリ画面 ${index + 1}`;
  image.decoding = "sync";

  const island = document.createElement("span");
  island.className = "screen__island";
  island.setAttribute("aria-hidden", "true");

  canvas.append(image, island);

  for (const annotation of annotationsByScreen.get(index) ?? []) {
    const element = document.createElement("div");
    element.className = `annotation annotation--${annotation.kind}`;
    element.style.left = `${annotation.x}%`;
    element.style.top = `${annotation.y}%`;

    if (annotation.w != null) element.style.width = `${annotation.w}%`;
    if (annotation.h != null) element.style.height = `${annotation.h}%`;
    if (annotation.tone) element.dataset.tone = annotation.tone;
    if (annotation.arrow) element.dataset.arrow = annotation.arrow;
    if (annotation.text) element.textContent = annotation.text;

    canvas.append(element);
  }

  frame.append(canvas);
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
