# インフラ手動整理記録（2026-10-05）

## 対象と許可

ユーザーの「現状の整理と文書化」の明示的な依頼に基づき、今回の削除だけを実施した。将来の削除や自動削除の包括的な許可ではない。保持条件と今後の報告手順は [インフラ費用削減](infrastructure-cost-reduction.md) を正本とする。

対象はGCP `foodfolio-af28aa`、`asia-southeast1`のAPI / WorkerとArtifact Registry `foodfolio/app`。service、repository、DB、ユーザー画像、secretは削除していない。Job、Scheduler、定期workflow、通知連携、Terraform変更、デプロイは追加・実行していない。

## 結果

- 計画確定: 2026-10-05 17:15:42 JST。年齢の基準: `2026-09-05T08:15:42.145943+00:00` より前に作成されたもの。
- 最終再取得確認: 2026-10-05 23:14:21 JST。
- 追加計画: 2026-10-05 23:12:38 JST。追加分の年齢基準: `2026-09-05T14:12:38.918518+00:00`。初回計画後に30日超となったrevision 3件と、これらだけが参照するimage 1件を同じ許可・保護条件で再確認して整理した。
- API revision: 52件から38件（14件削除）。Worker revision: 56件から39件（17件削除）。合計108件から77件。
- Registry version: 57件から35件（22件削除）。親index 3件、platform / attestation子manifest 6件を含む。
- 削除前後の集合差分が計画した31 revision / 22 digestと完全一致。残存77 revisionが参照する35 digestは全て存在する。
- 全regionのCloud Run serviceはAPI / Workerの2件。全regionのJobは0件。確認済み公開版の各3件とそのdigestを保持した。
- 現在のAPI `foodfolio-dev-api-00052-2tz`、Worker `foodfolio-dev-worker-00056-jnj`、各traffic 100%を維持。最終のReady・期待digest確認とAPI `/health`（HTTP 200、`{"status":"ok"}`）が成功。
- Artifact Registryの標準cleanupは引き続きdry run。30日超・最新10件・`keep-`の既存preview設定を変更していない。
- 削除したversionの表示image size合計は5,437,301,915 bytes（サイズ表示のない親index 3件を除く）。共有layerの重複を含むため、実際に解放した容量や費用削減額ではない。請求の減額は未確認。

## 保持した確認済み公開版

以下は単なるReady状態ではなく、各Runの`verify-cloud-run-deployment.mjs`成功結果、期待image / digest、registryのGit SHA tag、現在残存するrevisionのdigestを照合した記録。確認済みとはReady・配信先・期待digestの確認成功であり、認証付き操作やWorker解析の実処理成功ではない。

| 成功確認時刻            | Service                | Revision                         | Git SHA                                    | 確認根拠                                                                                    |
| ----------------------- | ---------------------- | -------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| 2026-10-05 01:33:29 JST | `foodfolio-dev-api`    | `foodfolio-dev-api-00052-2tz`    | `493ed7ea9d12e378510d1c2c0a2b2583a61830df` | [Deploy dev Run 37217030911](https://github.com/Kay-pht/foodfolio/actions/runs/37217030911) |
| 2026-10-05 01:33:46 JST | `foodfolio-dev-worker` | `foodfolio-dev-worker-00056-jnj` | `493ed7ea9d12e378510d1c2c0a2b2583a61830df` | [Deploy dev Run 37217030911](https://github.com/Kay-pht/foodfolio/actions/runs/37217030911) |
| 2026-10-04 23:29:29 JST | `foodfolio-dev-api`    | `foodfolio-dev-api-00051-nkb`    | `11c1aee7a6ce9f86731518593b701ce48772c370` | [Deploy dev Run 37209248424](https://github.com/Kay-pht/foodfolio/actions/runs/37209248424) |
| 2026-10-04 23:29:48 JST | `foodfolio-dev-worker` | `foodfolio-dev-worker-00055-89p` | `11c1aee7a6ce9f86731518593b701ce48772c370` | [Deploy dev Run 37209248424](https://github.com/Kay-pht/foodfolio/actions/runs/37209248424) |
| 2026-10-04 11:17:13 JST | `foodfolio-dev-api`    | `foodfolio-dev-api-00050-cpj`    | `a164cba0281c40c61763b2561945396c736d9faa` | [Deploy dev Run 37170422139](https://github.com/Kay-pht/foodfolio/actions/runs/37170422139) |
| 2026-10-04 11:17:31 JST | `foodfolio-dev-worker` | `foodfolio-dev-worker-00054-wrm` | `a164cba0281c40c61763b2561945396c736d9faa` | [Deploy dev Run 37170422139](https://github.com/Kay-pht/foodfolio/actions/runs/37170422139) |

| Git SHA                                    | 保持するimmutable digest                                                                                                                |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `493ed7ea9d12e378510d1c2c0a2b2583a61830df` | `asia-southeast1-docker.pkg.dev/foodfolio-af28aa/foodfolio/app@sha256:3130990d723701b8797ddcce9942c6724d48571d788ccc9c18728e3a9870fdbf` |
| `11c1aee7a6ce9f86731518593b701ce48772c370` | `asia-southeast1-docker.pkg.dev/foodfolio-af28aa/foodfolio/app@sha256:26a0803a062170e5acb47c1a78ce1c3c18fe3bb118e44507902403f817a31c7b` |
| `a164cba0281c40c61763b2561945396c736d9faa` | `asia-southeast1-docker.pkg.dev/foodfolio-af28aa/foodfolio/app@sha256:c9e4bf87ce3498703b0ca56a76dc53c0db8bfba15d27e823ed5275f3e67e8e58` |

Deploy dev Run `37219121153`は成功しているが、新しい公開revisionの確認結果がないため、この3版には数えていない。

## 削除したリビジョン

| Revision                         | 作成時刻                | 削除完了の確認時刻      |
| -------------------------------- | ----------------------- | ----------------------- |
| `foodfolio-dev-worker-00001-wzq` | 2026-08-27 22:38:18 JST | 2026-10-05 17:16:32 JST |
| `foodfolio-dev-api-00001-8qf`    | 2026-08-27 22:38:51 JST | 2026-10-05 17:16:38 JST |
| `foodfolio-dev-worker-00002-fdb` | 2026-08-27 22:58:48 JST | 2026-10-05 17:16:43 JST |
| `foodfolio-dev-api-00002-28j`    | 2026-08-27 22:59:22 JST | 2026-10-05 17:16:49 JST |
| `foodfolio-dev-worker-00003-7f4` | 2026-08-27 23:15:18 JST | 2026-10-05 17:16:54 JST |
| `foodfolio-dev-api-00003-5zn`    | 2026-08-27 23:16:02 JST | 2026-10-05 17:17:00 JST |
| `foodfolio-dev-worker-00004-n7v` | 2026-08-28 15:19:11 JST | 2026-10-05 17:17:05 JST |
| `foodfolio-dev-api-00004-r98`    | 2026-08-28 15:19:48 JST | 2026-10-05 17:21:45 JST |
| `foodfolio-dev-api-00005-zmq`    | 2026-08-28 15:36:11 JST | 2026-10-05 17:21:51 JST |
| `foodfolio-dev-worker-00005-87p` | 2026-08-28 15:36:11 JST | 2026-10-05 17:21:57 JST |
| `foodfolio-dev-worker-00006-psq` | 2026-08-31 11:46:57 JST | 2026-10-05 17:22:03 JST |
| `foodfolio-dev-worker-00007-65r` | 2026-08-31 22:06:52 JST | 2026-10-05 17:22:09 JST |
| `foodfolio-dev-worker-00008-c5q` | 2026-08-31 22:10:46 JST | 2026-10-05 17:22:16 JST |
| `foodfolio-dev-api-00006-2wr`    | 2026-08-31 22:11:33 JST | 2026-10-05 17:22:22 JST |
| `foodfolio-dev-worker-00009-fhw` | 2026-09-02 08:21:38 JST | 2026-10-05 17:22:28 JST |
| `foodfolio-dev-api-00007-xh2`    | 2026-09-02 08:22:17 JST | 2026-10-05 17:22:35 JST |
| `foodfolio-dev-worker-00010-pb4` | 2026-09-02 10:52:10 JST | 2026-10-05 17:22:40 JST |
| `foodfolio-dev-api-00008-lzn`    | 2026-09-02 10:52:45 JST | 2026-10-05 17:22:47 JST |
| `foodfolio-dev-worker-00011-9jf` | 2026-09-03 17:16:24 JST | 2026-10-05 17:22:53 JST |
| `foodfolio-dev-api-00009-fr4`    | 2026-09-03 17:16:57 JST | 2026-10-05 17:48:22 JST |
| `foodfolio-dev-worker-00012-9cd` | 2026-09-04 16:22:18 JST | 2026-10-05 23:02:24 JST |
| `foodfolio-dev-api-00010-qcr`    | 2026-09-04 16:23:00 JST | 2026-10-05 23:02:30 JST |
| `foodfolio-dev-worker-00013-wnt` | 2026-09-04 19:42:59 JST | 2026-10-05 23:02:36 JST |
| `foodfolio-dev-api-00011-w6b`    | 2026-09-04 19:43:50 JST | 2026-10-05 23:02:42 JST |
| `foodfolio-dev-worker-00014-vgw` | 2026-09-04 22:40:34 JST | 2026-10-05 23:02:47 JST |
| `foodfolio-dev-api-00012-9r7`    | 2026-09-04 22:41:13 JST | 2026-10-05 23:02:53 JST |
| `foodfolio-dev-worker-00015-759` | 2026-09-05 00:03:52 JST | 2026-10-05 23:02:59 JST |
| `foodfolio-dev-api-00013-482`    | 2026-09-05 00:04:55 JST | 2026-10-05 23:03:05 JST |
| `foodfolio-dev-worker-00016-8jn` | 2026-09-05 20:30:35 JST | 2026-10-05 23:12:47 JST |
| `foodfolio-dev-api-00014-bkv`    | 2026-09-05 20:31:15 JST | 2026-10-05 23:12:53 JST |
| `foodfolio-dev-worker-00017-lkj` | 2026-09-05 22:40:52 JST | 2026-10-05 23:13:00 JST |

## 削除したイメージ

以下のdigestは全て`asia-southeast1-docker.pkg.dev/foodfolio-af28aa/foodfolio/app`内。対象versionに付いていた以下のtagも削除した。保持したversionのtagは変更していない。

| Digest                                                                    | 作成時刻                | 削除したtag                                |
| ------------------------------------------------------------------------- | ----------------------- | ------------------------------------------ |
| `sha256:8d36d135e648dbfc3982e64c9e39b8c81c734a4803c1245fc81f957c1cd4aa51` | 2026-08-28 15:35:59 JST | `manual-recipe-url-fix-20260828-1534`      |
| `sha256:75308b14028ee33c7f59cba6c3da1c01baed68fdb233c5bf29d9bcec51f6c9d0` | 2026-08-31 11:46:43 JST | `6ff12066340457739031e761e3ec7dd494b1a0e7` |
| `sha256:547d7f1d11c51f4c32b62b27d963e202ce9ccf643f528c96e5ea752b79938d6a` | 2026-08-31 22:10:32 JST | `b8d86edc440d33384f915fd8f85f5edef7a71fc2` |
| `sha256:b62cbb755299ea3f79d3c07c461f7fcbdc14cefde6a73a2d8889e7794bcb8289` | 2026-08-27 21:15:26 JST | `dev-bootstrap-20260827`                   |
| `sha256:138e3183d2e0712b23b3942428f818d2f7d7ba8c573733a9fb0f50e4b2a4bd69` | 2026-08-27 21:18:34 JST | `dev-bootstrap-20260827-2`                 |
| `sha256:7a3fb8a3a0be556dfa29fdcd00b8020cfc973957de460d15254db8eb34fe320b` | 2026-08-27 22:58:10 JST | `mvp-7f7bed6`                              |
| `sha256:2a50dd6153f361338940072779aefb9cdf4b48095727bd625b50731e59d31f9a` | 2026-08-27 23:14:45 JST | `mvp-90926e9`                              |
| `sha256:bc195451e35d242d925d67bbf37f2a918b31ecef9d833fcb9196426eaf143954` | 2026-08-28 15:19:07 JST | `6a39c5c0286e9cf8b9935fdb8be39da3bd19d2b5` |
| `sha256:960bffa4d5bfe00b5f2c529021d592651ce37f81ad68afebf91e21640d3608c7` | 2026-08-28 15:35:57 JST | なし                                       |
| `sha256:bf5a7b9c72ab150396fda4cfe1b11ae3149655b1735ed92513fb891b8b802158` | 2026-08-28 15:35:58 JST | なし                                       |
| `sha256:ebabfa6902f7faebb464739f2ac1d9ff4b8462a94e39d093ded610f12d20730a` | 2026-08-31 11:46:42 JST | なし                                       |
| `sha256:e915cfec86262fde399a677dee89111f9c9f1859e98a02af687a0514cfa1fcbd` | 2026-08-31 11:46:43 JST | なし                                       |
| `sha256:e83371db384412f95f6841ac6a1928f555672252e185baa0f83cee48af7e648b` | 2026-08-31 22:10:31 JST | なし                                       |
| `sha256:fbcc091f17180bfde5f1ffc26e966c5a971dfd9e706f7cb90b5ceeba4094e068` | 2026-08-31 22:10:31 JST | なし                                       |
| `sha256:d220e7ac136338f492f6385b38f059b85ef5711b5130579ed7c45f0527b6e6fb` | 2026-09-02 08:21:28 JST | `0c4e99d9c2775d8e70d11dc26e45aef991423824` |
| `sha256:9871a19a79e683a71eb9f3f7605fd2ed9806f098be196d243450750b538a0f1e` | 2026-09-02 10:52:06 JST | `8510ee631e5ebe98916c9e1a7b37b5c618706aea` |
| `sha256:4ff4759d862e55c87ab03af205c120b5b8dd0bd71403e7fa0a55b7bb7efbd576` | 2026-09-03 17:16:17 JST | `89ac9d1a7173a29a894d0b2db9d0ca46560d3f64` |
| `sha256:bdd1045a00e2c6b118bf2b6f8f89dc63f189de8f7640a91328d0b6abfdf41912` | 2026-09-04 16:22:12 JST | `091d134e02e2cdf1cd0c22bb98cd5ab109d101f2` |
| `sha256:0cb88d733266d44209623562322e9ce44b51dc90320ef7607fe22128ecec4f58` | 2026-09-04 19:42:54 JST | `1dce9a1db4765ec0121eae8c49eaa2c04af28c2a` |
| `sha256:45cb2951f401fd10640eeb43a8c10dd5b49fe3179f3dfa66f781b9c5c98e1283` | 2026-09-04 22:40:28 JST | `4125e9a3dfcc7f9510826dc2ecc83e3da87700a1` |
| `sha256:3a0297377cdb0074680c94c1f8a5ee7c6e60c785872c75c8b9432be5839779f8` | 2026-09-05 00:03:46 JST | `5100b7363198be998e64c9bbb133b6cd92f70bbb` |
| `sha256:b957da64a61e8b2b6063d52a7169f777382144f3fdf394535bdb2dadf64e836c` | 2026-09-05 20:30:29 JST | `add4edc060e3ee04d3b98b4576f2761e91c76b90` |

### 親子manifestの照合

Docker manifest取得でrepository内の全index 3件を確認し、残存する親から候補childへの参照がないことを照合した。親indexを先に削除し、一覧を再取得してから子manifestを削除した。

| 削除した親index                                                           | 削除した子manifest                                                                                                                                   |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sha256:547d7f1d11c51f4c32b62b27d963e202ce9ccf643f528c96e5ea752b79938d6a` | `sha256:fbcc091f17180bfde5f1ffc26e966c5a971dfd9e706f7cb90b5ceeba4094e068`, `sha256:e83371db384412f95f6841ac6a1928f555672252e185baa0f83cee48af7e648b` |
| `sha256:75308b14028ee33c7f59cba6c3da1c01baed68fdb233c5bf29d9bcec51f6c9d0` | `sha256:ebabfa6902f7faebb464739f2ac1d9ff4b8462a94e39d093ded610f12d20730a`, `sha256:e915cfec86262fde399a677dee89111f9c9f1859e98a02af687a0514cfa1fcbd` |
| `sha256:8d36d135e648dbfc3982e64c9e39b8c81c734a4803c1245fc81f957c1cd4aa51` | `sha256:960bffa4d5bfe00b5f2c529021d592651ce37f81ad68afebf91e21640d3608c7`, `sha256:bf5a7b9c72ab150396fda4cfe1b11ae3149655b1735ed92513fb891b8b802158` |

## 中断と再確認

- CLIで`foodfolio-dev-api-00004-r98`の削除が120秒でタイムアウトしたため、その時点で続行を停止した。配信先・デプロイ状況・対象の年齢とdigestを再取得してからCloud Run v2 APIで削除し、operationの成功と一覧からの消失を確認した。
- 後続の`foodfolio-dev-worker-00012-9cd`のCLI describeも35秒でタイムアウトしたため、削除前に停止した。対象は削除されていなかった。全体状態を再確認し、v2 API GETのname・createTime・container image digestを照合してから削除を再開した。
- タイムアウトの原因は未特定。失敗したCLIを削除成功の根拠にはしていない。再開後の全削除operationと最終一覧差分で結果を確認した。

## 検証とチェックリスト

- [x] サービスごとに3つの確認済み公開revisionの証拠を確定
- [x] 30日超・保護対象外のrevision / digest一覧と親子manifestを照合
- [x] リビジョン削除後に残存参照を再取得してイメージを削除
- [x] 正確な集合差分、全保持image、配信先、Ready、期待digest、API health、dry run維持を確認
- [x] 保持・報告・許可・削除順序・停止条件・今後の記録方法を正本文書へ反映
- [x] `npm run verify`成功（単体454件、結合58件、E2E 52件、lint、format、build、P0 / spec / architecture / docs / task checks、Prisma generate / validate）
- [x] 変更Markdownのformatと最終の文書・spec・task check成功

iOSソース、API契約、Xcode設定の変更はないため`npm run verify:ios`は対象外。実環境ではAPI healthと配信revisionを確認した。認証付きデータ変更・Worker解析・通知は実施していない。今回の項目は上記整理記録内で管理し、無関係な`tasks/todo.md`の項目は更新していない。
