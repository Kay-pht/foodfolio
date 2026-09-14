# ChatGPT / Gemini 公開共有リンク PoC 結果

## 目的

ChatGPT と Gemini の公開共有会話URLから、認証情報やブラウザCookieを使わずに会話本文を取得し、Foodfolioのレシピ取り込みへ利用できるかを検証した。

この文書は2026-09-14時点の検証結果を記録する。provider内部仕様は将来変更される可能性があるため、現在仕様の正本ではなく本番実装の判断根拠として扱う。

## 検証対象と結果

実際のローカル検証では次の公開共有リンクを使用した。

- ChatGPT: `https://chatgpt.com/share/6aa7b428-1b5c-83e8-80c8-ade0e5e863c7`
  - パスタのレシピ提案に対し、後続ターンで「トマト缶を使わない」「ごま油を使う」「酸味が強い場合」の修正・追加質問がある会話。
  - ordered transcriptとして `user` 3件 / `assistant` 3件を復元できた。
- Gemini: `https://share.gemini.google/UZKqemYNDvzR`
  - オムライスのレシピを尋ねる公開共有会話。
  - 匿名の共有取得経路から `user` 1件 / `assistant` 1件を復元できた。

検証件数は各provider 1公開共有会話である。これらは検証時点で公開されていた再現用リンクであり、provider側で共有停止・削除・仕様変更が行われれば将来アクセスできなくなる可能性がある。本番テストfixtureとして依存せず、PoCの再現情報としてのみ扱う。

## 結論

両providerとも、公開共有URLから認証なしで `user` / `assistant` の会話本文を復元できた。ログイン必須・workspace限定・非公開会話のアクセス制御を回避する必要はない。

### ChatGPT

- `chatgpt.com/share/...` の有効な公開共有ページを通常のHTTP GETで取得できる。
- visible bodyには会話本文が出ないが、共有ページ内のprovider固有script stateに会話データが含まれる。
- conversation mappingとcurrent nodeを使ってactive branchを時系列順に復元できた。
- visually hiddenなメッセージや旧Custom Instructions由来のプレースホルダは会話本文から除外する必要がある。
- ブラウザ実行は不要だった。

### Gemini

- `share.gemini.google/...` はcanonicalな `gemini.google.com/share/...` へ解決できる。
- 初期HTMLはSPA shell中心で、実会話本文は含まれない。
- Gemini公開共有フロントエンドが利用する匿名のfirst-party取得経路から、認証・Cookieなしで会話本文を取得できた。
- 取得経路は公開APIとして文書化されたものではないため、provider adapterとして隔離し、形式変更を明確に検知できるようにする必要がある。
- Nodeの標準 `fetch` ではGoogle側レスポンスヘッダーが既定上限を超える場合があった。全体の `NODE_OPTIONS` を恒久的に変更せず、Gemini向けHTTP処理だけで必要なheader上限を設定する設計が必要。

## ChatGPT の再現可能な検証証跡

### 実行環境

- Node.js: `v24.18.0`
- 取得はFoodfolioの通常HTTP取得と同じく公開URLへの匿名GETで行った。
- ChatGPTログイン、Cookie、Authorization header、account tokenは使用していない。
- 検証時レスポンスはHTTP `200`、約559 KBだった。

### 取得したscript stateのsanitized shape

有効な共有ページではvisible bodyではなく、`client-bootstrap` とは別のscript内に共有会話が含まれていた。検証時の外側wrapperと、reference tableを復元した後の論理構造は次の形だった。

```text
<script>
  streamController.enqueue("<JSON-encoded provider payload>")
</script>

JSON.parse(enqueuedString)
  -> flattened reference table
  -> referenceを復元
  -> {
       current_node: "<active-node-id>",
       mapping: {
         "<node-id>": {
           parent: "<parent-node-id>" | null,
           message: {
             author: { role: "user" | "assistant" },
             content: { parts: ["<message text>", ...] },
             metadata: {
               is_visually_hidden_from_conversation?: true
             }
           }
         }
       }
     }
```

provider payloadは通常のobject treeだけでなくflattened reference tableを含んでいた。PoCではobject keyの `_<index>` をtable内の文字列keyへ、integer値をtable内の参照先へdereferenceしてから `mapping` / `current_node` を探索した。

### active branchの復元手順

1. `client-bootstrap` を除くscriptから、直接JSONに見えるpayloadと `streamController.enqueue("...")` の文字列payloadを抽出する。
2. payloadをJSON parseし、flattened reference table形式なら参照を復元する。
3. 復元object treeを再帰探索し、`mapping` と `current_node`（または `currentNode`）を持つconversation objectを見つける。
4. `current_node` から各nodeの `parent` をroot方向へたどり、得られたnode列をreverseしてactive branchを時系列順にする。
5. 各nodeの `message.author.role` が `user` / `assistant` のものだけを対象にし、`message.content.parts` の文字列を本文として連結する。
6. `metadata.is_visually_hidden_from_conversation === true` のmessageと、旧Custom Instructions由来の `Original custom instructions no longer available` は会話本文から除外する。

### 最小再現コマンド

PoCコードをrepositoryへ残さず、公開共有ページから同じ構造を確認するためのstandalone版は次の通り。全文は出力せず、件数・role・220文字までのexcerptだけを表示する。

```bash
node --input-type=module <<'NODE'
const input = 'https://chatgpt.com/share/6aa7b428-1b5c-83e8-80c8-ade0e5e863c7';
const response = await fetch(input, {
  redirect: 'follow',
  headers: { 'user-agent': 'Foodfolio/1.0 recipe metadata fetcher' },
});
const html = await response.text();

const payloads = [];
const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/giu;
for (const match of html.matchAll(scriptPattern)) {
  const attrs = match[1];
  const raw = match[2].trim();
  if (/\bid\s*=\s*["']client-bootstrap["']/iu.test(attrs) || !raw) continue;
  if (raw.startsWith('{') || raw.startsWith('[')) payloads.push(raw);
  const enqueuePattern = /streamController\.enqueue\(("(?:\\.|[^"\\])*")\)/gu;
  for (const item of raw.matchAll(enqueuePattern)) {
    try {
      const decoded = JSON.parse(item[1]);
      if (typeof decoded === 'string' && decoded.trim()) payloads.push(decoded);
    } catch {}
  }
}

const asRecord = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : null;

function decodeReferenceTable(value) {
  if (!Array.isArray(value) || value.length < 2) return value;
  const table = value;
  const cache = new Map();
  const active = new Set();

  const decodeIndex = (index) => {
    if (!Number.isInteger(index) || index < 0 || index >= table.length) return undefined;
    if (cache.has(index)) return cache.get(index);
    if (active.has(index)) return undefined;
    active.add(index);
    const decoded = decodeValue(table[index]);
    active.delete(index);
    cache.set(index, decoded);
    return decoded;
  };

  const decodeValue = (current) => {
    if (Array.isArray(current)) {
      return current.map((item) =>
        typeof item === 'number' && Number.isInteger(item) ? decodeIndex(item) : decodeValue(item),
      );
    }
    const record = asRecord(current);
    if (!record) return current;
    const decoded = {};
    let referenceKeyCount = 0;
    for (const [rawKey, rawValue] of Object.entries(record)) {
      const keyMatch = /^_(\d+)$/u.exec(rawKey);
      if (!keyMatch) {
        decoded[rawKey] = decodeValue(rawValue);
        continue;
      }
      referenceKeyCount += 1;
      const key = decodeIndex(Number(keyMatch[1]));
      if (typeof key !== 'string') continue;
      decoded[key] =
        typeof rawValue === 'number' && Number.isInteger(rawValue)
          ? decodeIndex(rawValue)
          : decodeValue(rawValue);
    }
    return referenceKeyCount > 0 ? decoded : current;
  };

  return decodeIndex(0) ?? value;
}

function* walkObjects(value) {
  if (Array.isArray(value)) {
    for (const item of value) yield* walkObjects(item);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  yield record;
  for (const item of Object.values(record)) yield* walkObjects(item);
}

function parseMessage(value) {
  const message = asRecord(value);
  const author = asRecord(message?.author);
  const role = author?.role;
  if (role !== 'user' && role !== 'assistant') return null;
  const metadata = asRecord(message.metadata);
  if (metadata?.is_visually_hidden_from_conversation === true) return null;
  const parts = asRecord(message.content)?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts
    .filter((part) => typeof part === 'string')
    .map((part) => part.replace(/\s+/gu, ' ').trim())
    .filter(Boolean)
    .join('\n');
  if (!text || (role === 'user' && text === 'Original custom instructions no longer available')) return null;
  return { role, text };
}

let mappingFound = false;
let currentNodeFound = false;
let messages = [];
for (const payload of payloads) {
  let parsed;
  try { parsed = JSON.parse(payload); } catch { continue; }
  for (const root of [parsed, decodeReferenceTable(parsed)]) {
    for (const candidate of walkObjects(root)) {
      const mapping = asRecord(candidate.mapping);
      if (!mapping) continue;
      mappingFound = true;
      const currentNode =
        typeof candidate.current_node === 'string'
          ? candidate.current_node
          : typeof candidate.currentNode === 'string'
            ? candidate.currentNode
            : null;
      if (!currentNode || !mapping[currentNode]) continue;
      currentNodeFound = true;
      const path = [];
      const visited = new Set();
      let cursor = currentNode;
      while (cursor && !visited.has(cursor)) {
        visited.add(cursor);
        const node = asRecord(mapping[cursor]);
        if (!node) break;
        path.push(node);
        cursor = typeof node.parent === 'string' ? node.parent : null;
      }
      path.reverse();
      const recovered = path.map((node) => parseMessage(node.message)).filter(Boolean);
      if (recovered.length > messages.length) messages = recovered;
    }
  }
}

console.log(JSON.stringify({
  status: response.status,
  payloadCount: payloads.length,
  mappingFound,
  currentNodeFound,
  messageCount: messages.length,
  userCount: messages.filter((m) => m.role === 'user').length,
  assistantCount: messages.filter((m) => m.role === 'assistant').length,
  messages: messages.map((m, index) => ({
    index,
    role: m.role,
    chars: m.text.length,
    excerpt: m.text.slice(0, 220),
  })),
}, null, 2));
NODE
```

### 2026-09-14 の実測結果

同じ公開共有URLを最終確認したときの主要結果は次の通りだった。

```json
{
  "status": 200,
  "payloadCount": 2,
  "decodedRootCount": 2,
  "mappingFound": true,
  "currentNodeFound": true,
  "messageCount": 6,
  "userCount": 3,
  "assistantCount": 3,
  "roles": ["user", "assistant", "user", "assistant", "user", "assistant"],
  "firstUserExcerpt": "これとこれの缶を使ったトマトを作ろうと思ってるけど、これを使った、またはこれに似た類似商品を使ったパスタのレシピを教えてください。",
  "lastUserExcerpt": "ソースの酸味が強い場合は？"
}
```

初回の構造復元では会話外の `Original custom instructions no longer available` がuser messageとして1件混入したが、`metadata.is_visually_hidden_from_conversation` と既知placeholderを除外する修正後に `user 3 / assistant 3` となり、画面上の実会話と一致した。

## Gemini の再現可能な検証証跡

### 実行環境

- Node.js: `v24.18.0`
- 検証時のみ `NODE_OPTIONS='--max-http-header-size=131072'` を設定した。
- Googleアカウントのログイン、Cookie、Authorization header、account tokenは使用していない。

### 取得手順

1. `https://share.gemini.google/<share-id>` を `redirect: 'follow'` でGETする。
2. 最終URL `https://gemini.google.com/share/<canonical-id>` から共有IDを取得する。
3. 次の匿名POSTを行う。

```text
POST https://gemini.google.com/_/BardChatUi/data/batchexecute
query:
  rpcids=ujx1Bf
  source-path=/share/<canonical-id>
  hl=en-US
  rt=c

headers:
  content-type: application/x-www-form-urlencoded;charset=UTF-8
  x-same-domain: 1
  origin: https://gemini.google.com
  referer: https://gemini.google.com/

body:
  f.req = JSON.stringify([[[
    "ujx1Bf",
    JSON.stringify([null, "<canonical-id>", [4]]),
    null,
    "generic"
  ]]])
```

レスポンスは行単位の外側JSONを持ち、検証時は `row[0] === "wrb.fr"` かつ `row[1] === "ujx1Bf"` の行から `row[2]` のnested JSONを復元した。会話turnは復元payloadの `payload[0][1]` にあり、検証サンプルではuser本文を `turn[2][0]`、assistant候補群を `turn[3][0]` から取得できた。

### 最小再現コマンド

共有IDやresponse全文をログへ保存せず、件数とbounded excerptのみを確認する場合の最小形は次の通り。

```bash
NODE_OPTIONS='--max-http-header-size=131072' node --input-type=module <<'NODE'
const input = 'https://share.gemini.google/UZKqemYNDvzR';
const page = await fetch(input, { redirect: 'follow' });
await page.arrayBuffer();
const finalUrl = new URL(page.url);
const shareId = finalUrl.pathname.split('/').filter(Boolean)[1];
const rpc = 'ujx1Bf';
const inner = JSON.stringify([null, shareId, [4]]);
const fReq = JSON.stringify([[[rpc, inner, null, 'generic']]]);
const qs = new URLSearchParams({ rpcids: rpc, 'source-path': `/share/${shareId}`, hl: 'en-US', rt: 'c' });
const response = await fetch(`https://gemini.google.com/_/BardChatUi/data/batchexecute?${qs}`, {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
    'x-same-domain': '1',
    origin: 'https://gemini.google.com',
    referer: 'https://gemini.google.com/',
  },
  body: new URLSearchParams({ 'f.req': fReq }),
});
const text = await response.text();
let payload;
for (const line of text.split(/\r?\n/)) {
  if (!line.trim().startsWith('[[')) continue;
  try {
    for (const row of JSON.parse(line)) {
      if (Array.isArray(row) && row[0] === 'wrb.fr' && row[1] === rpc && typeof row[2] === 'string') {
        payload = JSON.parse(row[2]);
      }
    }
  } catch {}
}
const turns = payload?.[0]?.[1] ?? [];
const messages = [];
for (const turn of turns) {
  const user = turn?.[2]?.[0];
  if (typeof user === 'string' && user.trim()) messages.push({ role: 'user', text: user.trim() });
  for (const candidate of turn?.[3]?.[0] ?? []) {
    const parts = candidate?.[1];
    const assistant = Array.isArray(parts) ? parts.filter((v) => typeof v === 'string').join('\n\n') : '';
    if (assistant.trim()) { messages.push({ role: 'assistant', text: assistant.trim() }); break; }
  }
}
console.log(JSON.stringify({
  status: response.status,
  payloadFound: Boolean(payload),
  messageCount: messages.length,
  userCount: messages.filter((m) => m.role === 'user').length,
  assistantCount: messages.filter((m) => m.role === 'assistant').length,
  messages: messages.map((m, index) => ({
    index,
    role: m.role,
    chars: m.text.length,
    excerpt: m.text.replace(/\s+/g, ' ').slice(0, 220),
  })),
}, null, 2));
NODE
```

### 2026-09-14 の実測結果

```json
{
  "status": 200,
  "payloadFound": true,
  "messageCount": 2,
  "userCount": 1,
  "assistantCount": 1,
  "messages": [
    {
      "index": 0,
      "role": "user",
      "chars": 13,
      "excerpt": "オムライスのレシピを教えて"
    },
    {
      "index": 1,
      "role": "assistant",
      "chars": 1483,
      "excerpt": "王道のふんわりとした「ケチャップオムライス」の作り方をご紹介します。チキンライスを美味しく仕上げるコツは、ご飯を入れる前にケチャップを炒めて酸味を飛ばすことです。"
    }
  ]
}
```

最初の実行ではNode/Undiciが `UND_ERR_HEADERS_OVERFLOW` で本文取得前に停止した。検証時のみheader上限を128 KiBへ拡張すると、同一の匿名requestで上記結果を取得できた。この設定はPoC環境全体へ恒久適用する前提ではなく、本番ではGemini adapterのHTTP transportに閉じ込める。

## 本番実装への要件

本番対応では次を前提とする。

1. `SourceType` に `chatgpt` / `gemini` を独立追加する。
2. providerごとの取得・conversation復元処理を専用adapterへ分離する。
3. ChatGPT / Geminiの会話を共通のordered message構造へ正規化してからレシピ解析へ渡す。
4. Geminiのshort URLとcanonical URLは同一共有会話としてcanonicalizeし、重複Recipeを作らない。
5. 同じ料理について複数ターンの変更がある場合は、後の明示的変更を優先し、変更されていない情報を引き継いで1つの最終Recipeへ統合する。
6. 完全に異なる複数料理を1共有会話から分割保存する機能は初期対応対象外とする。
7. 公開共有のみ対応し、ログイン、Cookie、account token、private/workspace制限の回避は行わない。
8. provider内部形式が変わった場合は一般Web抽出へ静かにフォールバックせず、専用adapterの失敗として検知できるテストを持つ。

## PoCで不要になったもの

検証用CLI、診断ヒューリスティック、raw HTML保存処理、PoC専用fixture/specは本番コードから参照されないためmainへ残さない。本番実装時に、上記の確定事項をproduction layerのspec・adapter・testsとして改めて実装する。
