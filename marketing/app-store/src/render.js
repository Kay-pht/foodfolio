import { slides } from "./slides.js";
import {
  siGooglegemini,
  siInstagram,
  siTiktok,
  siYoutube,
} from "../node_modules/simple-icons/index.mjs";
import { faOpenai } from "../node_modules/@fortawesome/free-brands-svg-icons/index.mjs";

const sourceIcons = {
  tiktok: { viewBox: "0 0 24 24", path: siTiktok.path, color: siTiktok.hex },
  instagram: {
    viewBox: "0 0 24 24",
    path: siInstagram.path,
    color: siInstagram.hex,
  },
  youtube: {
    viewBox: "0 0 24 24",
    path: siYoutube.path,
    color: siYoutube.hex,
  },
  web: {
    viewBox: "0 0 24 24",
    path: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.92 6h-3.03a15.7 15.7 0 0 0-1.38-3.56A8.05 8.05 0 0 1 18.92 8ZM12 4c.83 1 1.53 2.35 1.86 4h-3.72C10.47 6.35 11.17 5 12 4ZM4.26 14a7.8 7.8 0 0 1 0-4h3.48a16.5 16.5 0 0 0 0 4H4.26Zm.82 2h3.03c.3 1.32.77 2.53 1.38 3.56A8.05 8.05 0 0 1 5.08 16Zm3.03-8H5.08a8.05 8.05 0 0 1 4.41-3.56A15.7 15.7 0 0 0 8.11 8ZM12 20c-.83-1-1.53-2.35-1.86-4h3.72C13.53 17.65 12.83 19 12 20Zm2.2-6H9.8a14.2 14.2 0 0 1 0-4h4.4a14.2 14.2 0 0 1 0 4Zm.31 5.56A15.7 15.7 0 0 0 15.89 16h3.03a8.05 8.05 0 0 1-4.41 3.56ZM16.26 14a16.5 16.5 0 0 0 0-4h3.48a7.8 7.8 0 0 1 0 4h-3.48Z",
    color: "281F1B",
  },
  chatgpt: {
    viewBox: `0 0 ${faOpenai.icon[0]} ${faOpenai.icon[1]}`,
    path: faOpenai.icon[4],
    color: "111111",
  },
  gemini: {
    viewBox: "0 0 24 24",
    path: siGooglegemini.path,
    color: siGooglegemini.hex,
  },
};

const params = new URLSearchParams(window.location.search);
const slideId = params.get("slide") ?? slides[0].id;
const slide = slides.find((candidate) => candidate.id === slideId) ?? slides[0];

const artboard = document.querySelector("#artboard");
const kicker = document.querySelector("#kicker");
const title = document.querySelector("#title");
const visual = document.querySelector("#visual");

artboard.dataset.layout = slide.layout;
artboard.dataset.theme = slide.theme ?? "coral";
artboard.dataset.hasBubbles = String((slide.bubbles?.length ?? 0) > 0);
if (slide.titleSize) {
  artboard.style.setProperty("--title-font-size", `${slide.titleSize}px`);
}
if (slide.phonePlacement) {
  artboard.style.setProperty(
    "--single-phone-top",
    `${slide.phonePlacement.top}px`,
  );
  artboard.style.setProperty(
    "--single-phone-width",
    `${slide.phonePlacement.width}px`,
  );
}
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

for (const bubble of slide.bubbles ?? []) {
  const element = document.createElement("div");
  element.className = `feature-bubble feature-bubble--${bubble.tone ?? "dark"}`;
  element.style.left = `${bubble.x}%`;
  element.style.top = `${bubble.y}%`;
  const icon = sourceIcons[bubble.icon];
  if (icon) {
    const iconWrap = document.createElement("span");
    iconWrap.className = "feature-bubble__icon";
    iconWrap.style.setProperty("--icon-color", `#${icon.color}`);
    iconWrap.setAttribute("aria-hidden", "true");

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", icon.viewBox);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", icon.path);
    svg.append(path);
    iconWrap.append(svg);
    element.append(iconWrap);
  }

  const label = document.createElement("span");
  label.textContent = bubble.text;
  element.append(label);
  visual.append(element);
}

const images = slide.images.map((src, index) => {
  const frame = document.createElement("figure");
  frame.className = `screen screen--${index + 1}`;

  const screenPlacement = slide.screenPlacements?.[index];
  if (screenPlacement) {
    frame.style.setProperty("--screen-left", `${screenPlacement.left}px`);
    frame.style.setProperty("--screen-top", `${screenPlacement.top}px`);
    frame.style.setProperty("--screen-width", `${screenPlacement.width}px`);
    frame.style.setProperty("--screen-rotate", `${screenPlacement.rotate}deg`);
    frame.style.setProperty("--screen-z", String(screenPlacement.z));
  }

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

    const labelPosition = slide.labelPositions?.[index];
    if (labelPosition) {
      labelElement.style.left = `${labelPosition.x}%`;
      labelElement.style.top = `${labelPosition.y}%`;
    }

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
