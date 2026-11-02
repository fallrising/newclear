# 完整度報表

快照 `atlas-public-2026-11-02`，觀察時間 `2026-11-02T14:47:12Z`。分母是來源 manifest 的 280 個條目，不是筆記篇數回推。原站分類 28 個。

| 項目 | 數量 |
| --- | --- |
| 來源條目（分母） | 280 |
| 已取得 fetched | 280 |
| 筆記 reviewed（計入完成） | 280 |
| 筆記 draft | 0 |
| 筆記 pending | 0 |
| blocked | 0 |
| 缺漏 | 0 |

宣告：`complete`。`reviewed` 只表示作者已對照本次快照的公開頁面與內嵌條目，不是獨立審查，也不是實玩驗證。pending、draft、blocked 與模板占位不計入完成。

## 缺漏 ID

無

## 入口差異

首頁觀察為 280 個機制、28 個分類。首頁可見文字寫 280 mechanics 與 28 mechanic groups；og:image:alt 寫 280 mechanics across 28 systems。沒有 JavaScript 的首頁只渲染精選範例，所以它不是分母。

- `projection` index-json-cases：index.json 的 cases 省略 catalog.json 才有的實作、來源、權利與觀察欄位。280 條索引都只差在這裡；識別欄位一致。
- `projection` index-json-prototype：index.json 的 prototype 只留 scope 與 interaction。catalog.json 另外有編輯用的 firstStep、pitfall 與 test，280 條都是這樣。這些編輯文字沒有抄進筆記。
- `entrance` homepage-noscript-sample：沒有 JavaScript 的首頁只露出精選機制，不是完整公開清單。分母來自對帳後的 sitemap、index、catalog 與逐條機制文件。
- `slug-prefix` prefix-differs-from-system：這些來源 ID 的 slug 前綴不是 system id：allocation-savings-interest、allocation-shop-reservation、exploration-air-action-refill、exploration-climbing-rest-route、exploration-gliding-descent、exploration-grapple-swing、exploration-stealth-awareness、exploration-wall-jump。

## 原站分類數量

| ID | 觀察到的英文名 | 條目 |
| --- | --- | --- |
| allocation | Drafting & allocation | 8 |
| automation | Crafting & automation | 10 |
| building | Building & space | 10 |
| combat | Combat & tactics | 18 |
| command | Unit coordination | 10 |
| commerce | Business & trade | 11 |
| cooking | Cooking & food | 10 |
| cooperation | Cooperation & social play | 9 |
| deckbuilding | Decks & synergies | 12 |
| defense | Defense & waves | 9 |
| driving | Vehicle handling | 5 |
| ecology | Breeding & ecology | 8 |
| exploration | Exploration & routes | 4 |
| farming | Farming & growth | 10 |
| fishing | Fishing & catching | 10 |
| gathering | Gathering & mining | 10 |
| incremental | Income & accumulation | 11 |
| inventory | Inventory & resources | 10 |
| matching | Matching & merging | 10 |
| movement | Movement & traversal | 15 |
| narrative | Dialogue & event choices | 10 |
| progression | Progression & legacy | 12 |
| projectiles | Aiming & projectiles | 10 |
| puzzles | Puzzles & deduction | 10 |
| relationships | Social & relationships | 10 |
| rhythm | Beats & timing | 5 |
| stealth | Stealth & identity | 11 |
| survival | Survival & needs | 12 |

## 逐條狀態

完整雜湊在 `sources/manifest.json`。下表只留前 12 碼，避免把雜湊手抄成第二份權威資料。

| 來源 ID | 原站分類 | 取得 | 筆記 | 雜湊前綴 |
| --- | --- | --- | --- | --- |
| allocation-area-majority | allocation | fetched | reviewed | 50680057c661 |
| allocation-follow-phase | allocation | fetched | reviewed | 631ebadf0822 |
| allocation-public-goal-race | allocation | fetched | reviewed | 6aa652877191 |
| allocation-public-pick | allocation | fetched | reviewed | b6762401e47c |
| allocation-route-denial | allocation | fetched | reviewed | d5960d58f940 |
| allocation-savings-interest | incremental | fetched | reviewed | 7f5dec8dae4e |
| allocation-shared-stock | allocation | fetched | reviewed | d9535471a1cb |
| allocation-shop-reservation | commerce | fetched | reviewed | fda659530a52 |
| allocation-snake-order | allocation | fetched | reviewed | 2132384a5b57 |
| allocation-worker-placement | allocation | fetched | reviewed | 0f28d24a90ad |
| automation-aerial-logistics | automation | fetched | reviewed | 88294f1c54e7 |
| automation-belt-routing | automation | fetched | reviewed | a3bfee1656a1 |
| automation-blueprint-reuse | automation | fetched | reviewed | d0643a64810c |
| automation-byproduct-loop | automation | fetched | reviewed | aa47efbfb8f4 |
| automation-conditional-control | automation | fetched | reviewed | 42caaeaf40b9 |
| automation-flow-splitting | automation | fetched | reviewed | d673353fdc60 |
| automation-fluid-routing | automation | fetched | reviewed | 8c7add1ed3cb |
| automation-item-filtering | automation | fetched | reviewed | 31be5c209586 |
| automation-power-budget | automation | fetched | reviewed | 72da0e5a83f9 |
| automation-production-chain | automation | fetched | reviewed | 8bf1cd9abfc6 |
| building-access-network | building | fetched | reviewed | 94ee788d6560 |
| building-construction-sequencing | building | fetched | reviewed | 8583a5d30f42 |
| building-modular-snapping | building | fetched | reviewed | 32259c23a342 |
| building-room-requirements | building | fetched | reviewed | 2566cb9c99a0 |
| building-service-coverage | building | fetched | reviewed | 123a83330341 |
| building-structural-support | building | fetched | reviewed | fb66d99dca18 |
| building-terrain-shaping | building | fetched | reviewed | aa5f087dc82a |
| building-thermal-zoning | building | fetched | reviewed | f9e1e82897fd |
| building-vertical-stacking | building | fetched | reviewed | a708aeb698b4 |
| building-water-engineering | building | fetched | reviewed | 436582bdc66a |
| combat-action-points | combat | fetched | reviewed | dc023eec0830 |
| combat-combat-deck-cycle | combat | fetched | reviewed | 526cd9ca4ee1 |
| combat-combo-variation | combat | fetched | reviewed | d1d1297d0e93 |
| combat-cover-flanking | combat | fetched | reviewed | 098fbe4b0d0c |
| combat-destructible-cover | combat | fetched | reviewed | 880f32ac2a8d |
| combat-forced-movement | combat | fetched | reviewed | f2b6abd7c6ec |
| combat-friendly-fire | combat | fetched | reviewed | 42a223e8de5d |
| combat-intent-preview | combat | fetched | reviewed | 4298373e32fb |
| combat-invulnerable-dodge | combat | fetched | reviewed | e1f1ab76f4cb |
| combat-overwatch | combat | fetched | reviewed | a81dd23034e1 |
| combat-part-destruction | combat | fetched | reviewed | 107287257193 |
| combat-pause-orders | combat | fetched | reviewed | 86924e8a2993 |
| combat-posture-break | combat | fetched | reviewed | 6d2263ca2ad9 |
| combat-simultaneous-orders | combat | fetched | reviewed | f6cf3e89345b |
| combat-stamina-budget | combat | fetched | reviewed | d3b692485f4d |
| combat-surface-reactions | combat | fetched | reviewed | 32d34369dac6 |
| combat-timed-parry | combat | fetched | reviewed | 0523d99bf4b5 |
| combat-weakpoint-aim | combat | fetched | reviewed | 59a281f893af |
| command-focus-fire | command | fetched | reviewed | 2448dfa413d5 |
| command-frontline-shielding | command | fetched | reviewed | f016f0e63153 |
| command-initiative-order | command | fetched | reviewed | 00fa775b642f |
| command-interrupt-action | command | fetched | reviewed | 833d4061c1b0 |
| command-prebattle-formation | command | fetched | reviewed | 7d4bbc3c2bbe |
| command-scout-current-vision | command | fetched | reviewed | a393d4c87ec6 |
| command-split-objectives | command | fetched | reviewed | 20e9fb2ad410 |
| command-threat-redirection | command | fetched | reviewed | 487a10d25043 |
| command-trait-thresholds | command | fetched | reviewed | 07ca69295d1f |
| command-workers-or-soldiers | command | fetched | reviewed | 37afc7464d1b |
| commerce-auction-bidding | commerce | fetched | reviewed | 88483e982c03 |
| commerce-debt-pressure | commerce | fetched | reviewed | 751fa6c0c663 |
| commerce-dynamic-market | commerce | fetched | reviewed | 2342fc2ee235 |
| commerce-haggling | commerce | fetched | reviewed | 5d652061fa37 |
| commerce-interpret-orders | commerce | fetched | reviewed | 47830c8acab2 |
| commerce-price-discovery | commerce | fetched | reviewed | b27101a2e712 |
| commerce-regional-arbitrage | commerce | fetched | reviewed | c2e64d289250 |
| commerce-shop-display | commerce | fetched | reviewed | 21d5b6bba320 |
| commerce-timed-contracts | commerce | fetched | reviewed | 3f53672e0939 |
| commerce-trade-route-programming | commerce | fetched | reviewed | 8108b799051e |
| cooking-food-preservation | cooking | fetched | reviewed | 084df3cf6740 |
| cooking-heat-window | cooking | fetched | reviewed | 239514b58e5b |
| cooking-ingredient-substitution | cooking | fetched | reviewed | e168fa229055 |
| cooking-judged-flavor | cooking | fetched | reviewed | 083d1bb89a95 |
| cooking-meal-loadout | cooking | fetched | reviewed | 067da5b31960 |
| cooking-measurement-precision | cooking | fetched | reviewed | 5956571c3ee7 |
| cooking-order-triage | cooking | fetched | reviewed | 7ca637579a97 |
| cooking-preparation-chain | cooking | fetched | reviewed | a57b82977350 |
| cooking-recipe-learning | cooking | fetched | reviewed | 335054603d38 |
| cooking-station-handoff | cooking | fetched | reviewed | e23168d7c1c6 |
| cooperation-complementary-abilities | cooperation | fetched | reviewed | 542874eb4107 |
| cooperation-discussion-vote | cooperation | fetched | reviewed | a34950ab384f |
| cooperation-downed-revival | cooperation | fetched | reviewed | ec11eb6bc3a5 |
| cooperation-hidden-role | cooperation | fetched | reviewed | 0bef97b61b18 |
| cooperation-physical-tether | cooperation | fetched | reviewed | 48025fee3c0d |
| cooperation-shared-vehicle | cooperation | fetched | reviewed | 6400a210e166 |
| cooperation-split-information | cooperation | fetched | reviewed | 1ef0a0209da9 |
| cooperation-synchronized-triggers | cooperation | fetched | reviewed | 1948c7cf1567 |
| cooperation-temporary-alliance | cooperation | fetched | reviewed | 3effbe9619aa |
| deckbuilding-card-upgrade | deckbuilding | fetched | reviewed | 88f1be638308 |
| deckbuilding-dice-allocation | deckbuilding | fetched | reviewed | 61c8b4ee4117 |
| deckbuilding-discard-redraw | deckbuilding | fetched | reviewed | 8f56378b40f9 |
| deckbuilding-dual-use-cards | deckbuilding | fetched | reviewed | ddcf2817ec79 |
| deckbuilding-duplicate-investment | deckbuilding | fetched | reviewed | 599664fe3f27 |
| deckbuilding-exhaust-for-burst | deckbuilding | fetched | reviewed | 9838d3bae76b |
| deckbuilding-opening-hand-control | deckbuilding | fetched | reviewed | 3ef04a520f0c |
| deckbuilding-poker-hand-requirements | deckbuilding | fetched | reviewed | e3f5e3d38cd1 |
| deckbuilding-reward-choice | deckbuilding | fetched | reviewed | 7562162454cf |
| deckbuilding-rule-changing-passives | deckbuilding | fetched | reviewed | 59fcf5088e0f |
| deckbuilding-temporary-generation | deckbuilding | fetched | reviewed | 6b1e83128c38 |
| deckbuilding-trigger-order | deckbuilding | fetched | reviewed | 7efd7a3fcc0f |
| defense-ammunition-supply | defense | fetched | reviewed | 38c1443458d4 |
| defense-day-night-investment | defense | fetched | reviewed | d5d38a33eb7b |
| defense-early-wave-call | defense | fetched | reviewed | 5dadca39bafb |
| defense-maze-routing | defense | fetched | reviewed | bed2f0743f8a |
| defense-mobile-defender | defense | fetched | reviewed | 68d4476c45ad |
| defense-resistance-counters | defense | fetched | reviewed | e0d74ca1cc71 |
| defense-target-priority | defense | fetched | reviewed | 1a4b75ba861d |
| defense-tower-upgrade-budget | defense | fetched | reviewed | 863910d4143b |
| defense-trap-sequence | defense | fetched | reviewed | 8d48553a6a06 |
| driving-air-balance | driving | fetched | reviewed | 06cb1290b9c1 |
| driving-air-stunt | driving | fetched | reviewed | e07ae2ca4df1 |
| driving-drift-boost | driving | fetched | reviewed | 7ef531dab183 |
| driving-slipstream | driving | fetched | reviewed | 9fa0182cb455 |
| driving-start-charge | driving | fetched | reviewed | f942390560df |
| ecology-animal-taming | ecology | fetched | reviewed | 2e2a1d1beaf4 |
| ecology-breeding-conditions | ecology | fetched | reviewed | c71dc6a99abf |
| ecology-genetic-diversity | ecology | fetched | reviewed | b8272d61c97d |
| ecology-habitat-capacity | ecology | fetched | reviewed | 3f00a1a1ee52 |
| ecology-parent-trait-selection | ecology | fetched | reviewed | ba1265705183 |
| ecology-plant-crossbreeding | ecology | fetched | reviewed | 6296eb1781c6 |
| ecology-population-limits | ecology | fetched | reviewed | 04edc898ceb6 |
| ecology-species-compatibility | ecology | fetched | reviewed | 7b31f2b23bfb |
| exploration-ability-gates | exploration | fetched | reviewed | 79dd297df120 |
| exploration-air-action-refill | movement | fetched | reviewed | 3f62551ba362 |
| exploration-climbing-rest-route | movement | fetched | reviewed | ce51b81a8242 |
| exploration-earned-map | exploration | fetched | reviewed | b3681b3e65d0 |
| exploration-fast-travel-network | exploration | fetched | reviewed | 8e551dc8dc34 |
| exploration-gliding-descent | movement | fetched | reviewed | 6fbcbce98c23 |
| exploration-grapple-swing | movement | fetched | reviewed | 7f571e396663 |
| exploration-procedural-route-reading | exploration | fetched | reviewed | aa7df9cacaa4 |
| exploration-stealth-awareness | stealth | fetched | reviewed | 8cc58353e4b8 |
| exploration-wall-jump | movement | fetched | reviewed | 26778783ce62 |
| farming-crop-protection | farming | fetched | reviewed | ce1cb5e202fb |
| farming-fertilizer-tradeoff | farming | fetched | reviewed | b37d372a7d09 |
| farming-growth-care | farming | fetched | reviewed | ce31b2fb1ce6 |
| farming-irrigation-layout | farming | fetched | reviewed | 4014b8a0fc64 |
| farming-livestock-care | farming | fetched | reviewed | 3f93c3dded56 |
| farming-orchard-investment | farming | fetched | reviewed | 4bdc62098de9 |
| farming-regrowth-crops | farming | fetched | reviewed | 8490d0b23b67 |
| farming-season-window | farming | fetched | reviewed | c54101145a0e |
| farming-seed-reinvestment | farming | fetched | reviewed | a8afc5ee79db |
| farming-substrate-match | farming | fetched | reviewed | 6b0774ca2dc1 |
| fishing-bait-loadout | fishing | fetched | reviewed | e5db5bb90638 |
| fishing-bite-window | fishing | fetched | reviewed | b945169156bc |
| fishing-cast-placement | fishing | fetched | reviewed | b937edc46fb6 |
| fishing-equipment-access | fishing | fetched | reviewed | f62c16dcc4a7 |
| fishing-habitat-search | fishing | fetched | reviewed | edc6f206c22e |
| fishing-line-tension | fishing | fetched | reviewed | 0280e6217891 |
| fishing-passive-traps | fishing | fetched | reviewed | b970751a5068 |
| fishing-pond-production | fishing | fetched | reviewed | f539e23c14bd |
| fishing-target-tracking | fishing | fetched | reviewed | 91e1eea8e93d |
| fishing-timed-contest | fishing | fetched | reviewed | 9f4cf7459ab8 |
| gathering-depth-targeting | gathering | fetched | reviewed | e84dd4de8831 |
| gathering-gathering-quota | gathering | fetched | reviewed | 6dc458699ce8 |
| gathering-hidden-deposit-clues | gathering | fetched | reviewed | 16ef76f147c3 |
| gathering-oxygen-gathering | gathering | fetched | reviewed | 03580e1cf7cc |
| gathering-renewable-forage-route | gathering | fetched | reviewed | e1dedafbb0d9 |
| gathering-resource-detection | gathering | fetched | reviewed | dd962dab2a38 |
| gathering-salvage-dismantling | gathering | fetched | reviewed | 2fb7b6493b5c |
| gathering-supply-mining | gathering | fetched | reviewed | 7e738958afb4 |
| gathering-tool-hardness | gathering | fetched | reviewed | 2877b79e0789 |
| gathering-volumetric-excavation | gathering | fetched | reviewed | f32657400e90 |
| incremental-allocate-progress-capacity | incremental | fetched | reviewed | e186291eae72 |
| incremental-escalating-copy-price | incremental | fetched | reviewed | c70269b10887 |
| incremental-farm-or-push | incremental | fetched | reviewed | 781b10b0be1c |
| incremental-limited-team-dispatch | incremental | fetched | reviewed | fce85c6342ff |
| incremental-manual-to-passive | incremental | fetched | reviewed | 1b86568fc51c |
| incremental-offline-window | incremental | fetched | reviewed | e072db7c01ae |
| incremental-overlap-income-bursts | incremental | fetched | reviewed | e01d39d8d4a4 |
| incremental-quantity-milestones | incremental | fetched | reviewed | 79d211ac9f37 |
| incremental-spend-held-bonus | incremental | fetched | reviewed | 3abca2be1375 |
| incremental-spend-time-advance | incremental | fetched | reviewed | 74852fca716e |
| inventory-adjacency | inventory | fetched | reviewed | c26f1781799d |
| inventory-death-retrieval | inventory | fetched | reviewed | a6bebe55fd0e |
| inventory-deck-thinning | inventory | fetched | reviewed | 838b6aebfc36 |
| inventory-durability | inventory | fetched | reviewed | 5ef032efc0c0 |
| inventory-equipment-budget | inventory | fetched | reviewed | d1a4ea2d4c72 |
| inventory-identification | inventory | fetched | reviewed | c9c20dac6ddd |
| inventory-light-reserve | inventory | fetched | reviewed | 018a91204226 |
| inventory-shape-packing | inventory | fetched | reviewed | acc0e0279c31 |
| inventory-stack-limits | inventory | fetched | reviewed | bd7a476d9445 |
| inventory-weight-budget | inventory | fetched | reviewed | 4ede41b7e578 |
| matching-clear-under-cargo | matching | fetched | reviewed | 219d4f657f4a |
| matching-combine-power-pieces | matching | fetched | reviewed | 6576abbfc891 |
| matching-complete-lines | matching | fetched | reviewed | d4fa6cbb271e |
| matching-gravity-cascade | matching | fetched | reviewed | eeaaaf577b13 |
| matching-merge-three-upgrade | matching | fetched | reviewed | 087ce595e2c3 |
| matching-pattern-creates-power | matching | fetched | reviewed | e84a3d2e2225 |
| matching-slide-board-merge | matching | fetched | reviewed | 6d4acad04ac9 |
| matching-swap-to-align | matching | fetched | reviewed | aa39d399e6cd |
| matching-tap-connected-group | matching | fetched | reviewed | 19e8985815d0 |
| matching-trace-color-chain | matching | fetched | reviewed | 264178722462 |
| movement-auto-forward | movement | fetched | reviewed | 0960a2ac9a14 |
| movement-carry-object | movement | fetched | reviewed | 81aa1abd6c83 |
| movement-downward-slam | movement | fetched | reviewed | db52ea9b94fd |
| movement-ledge-catch | movement | fetched | reviewed | 89f63b87ba71 |
| movement-low-slide | movement | fetched | reviewed | 5aeb24bb0dec |
| movement-moving-platform | movement | fetched | reviewed | 5100d5c185da |
| movement-run-walk-control | movement | fetched | reviewed | df2e603313eb |
| movement-short-retry | movement | fetched | reviewed | 93e5dbac6337 |
| movement-target-bounce | movement | fetched | reviewed | df8a42b80401 |
| movement-variable-jump | movement | fetched | reviewed | f3e8c6d11242 |
| narrative-background-dialogue-access | narrative | fetched | reviewed | b1e856b13378 |
| narrative-conversation-intervention | narrative | fetched | reviewed | 250a3994fb21 |
| narrative-delayed-choice-consequences | narrative | fetched | reviewed | de226d407b05 |
| narrative-deliberate-silence | narrative | fetched | reviewed | d5679489e866 |
| narrative-evidence-rebuttal | narrative | fetched | reviewed | 2a1d4758c37e |
| narrative-investigation-time-slots | narrative | fetched | reviewed | 51b3129646bc |
| narrative-loop-event-schedule | narrative | fetched | reviewed | c29aff2cc616 |
| narrative-perspective-handoff | narrative | fetched | reviewed | 24e5ec98ad18 |
| narrative-service-as-response | narrative | fetched | reviewed | 076dad8a6655 |
| narrative-timed-response | narrative | fetched | reviewed | 6825fe1183dd |
| progression-challenge-tiers | progression | fetched | reviewed | d94d3cd04442 |
| progression-death-loses-training | progression | fetched | reviewed | 080b71eb6df2 |
| progression-evolution-recipes | progression | fetched | reviewed | 44eb6c169e5d |
| progression-knowledge-gates | progression | fetched | reviewed | 38fa19e03f16 |
| progression-permanent-run-currency | progression | fetched | reviewed | 72f64e91b4ff |
| progression-practice-based-growth | progression | fetched | reviewed | 02f4b5691685 |
| progression-prestige-reset | progression | fetched | reviewed | 96b28e2eb4a2 |
| progression-random-level-choices | progression | fetched | reviewed | b7893621dfbe |
| progression-research-prerequisites | progression | fetched | reviewed | 16d67fa05788 |
| progression-respec-investment | progression | fetched | reviewed | e669d3c8179e |
| progression-specialization-branches | progression | fetched | reviewed | 06ed69d65ace |
| progression-successor-selection | progression | fetched | reviewed | 9b7393611255 |
| projectiles-active-reload | projectiles | fetched | reviewed | f12cc6d824fb |
| projectiles-ballistic-arc | projectiles | fetched | reviewed | 1d0787a7d8ef |
| projectiles-charged-release | projectiles | fetched | reviewed | fc27d147c207 |
| projectiles-graze-reward | projectiles | fetched | reviewed | bfd80af42a05 |
| projectiles-heat-pacing | projectiles | fetched | reviewed | ad8e76facb08 |
| projectiles-independent-aim | projectiles | fetched | reviewed | a93be788030f |
| projectiles-maintain-lock | projectiles | fetched | reviewed | 727d2c6e7223 |
| projectiles-piercing-line | projectiles | fetched | reviewed | 68153591da7e |
| projectiles-spread-recovery | projectiles | fetched | reviewed | 60bbe0187b9f |
| projectiles-wall-ricochet | projectiles | fetched | reviewed | 94e579514a2f |
| puzzles-beam-routing | puzzles | fetched | reviewed | ffa971ee6cbe |
| puzzles-box-pushing | puzzles | fetched | reviewed | 1e2e8bcd1a6c |
| puzzles-gravity | puzzles | fetched | reviewed | 2476fd80ccde |
| puzzles-language-decoding | puzzles | fetched | reviewed | 3b7c02584f6e |
| puzzles-linked-portals | puzzles | fetched | reviewed | 0fadac5198bf |
| puzzles-paper-folding | puzzles | fetched | reviewed | 3367babeaf62 |
| puzzles-perspective-reality | puzzles | fetched | reviewed | bd768d9d79c5 |
| puzzles-scene-deduction | puzzles | fetched | reviewed | 8b88cc1fbe18 |
| puzzles-time-scrubbing | puzzles | fetched | reviewed | b8b892a7dd9b |
| puzzles-visual-rule-learning | puzzles | fetched | reviewed | faf69c363fed |
| relationships-bond-scenes | relationships | fetched | reviewed | 10b292695ce4 |
| relationships-companion-approval | relationships | fetched | reviewed | 81d9b8239c13 |
| relationships-daily-contact | relationships | fetched | reviewed | 855acd78a690 |
| relationships-date-itinerary | relationships | fetched | reviewed | dbec2a5c37af |
| relationships-dynastic-marriage | relationships | fetched | reviewed | a233a8866e8b |
| relationships-faction-reputation | relationships | fetched | reviewed | 5c2ed5a69a90 |
| relationships-gift-allocation | relationships | fetched | reviewed | 052bdfc92e7d |
| relationships-persuasion-checks | relationships | fetched | reviewed | 177a45f6462b |
| relationships-relationship-commitment | relationships | fetched | reviewed | 0a7884db4428 |
| relationships-secrets-leverage | relationships | fetched | reviewed | 56fdb98fffbd |
| rhythm-cue-response | rhythm | fetched | reviewed | dfd23be2d08f |
| rhythm-hidden-beats | rhythm | fetched | reviewed | 65cd786c43ea |
| rhythm-onbeat-actions | rhythm | fetched | reviewed | 4d448caa613e |
| rhythm-streak-multiplier | rhythm | fetched | reviewed | aa14d6291e1b |
| rhythm-sustain-notes | rhythm | fetched | reviewed | c718a3aa3e82 |
| stealth-body-concealment | stealth | fetched | reviewed | 35d4702b5c6e |
| stealth-disguise-access | stealth | fetched | reviewed | f621bd2a99a1 |
| stealth-hiding-spots | stealth | fetched | reviewed | bb9b9cd09a64 |
| stealth-knockout-window | stealth | fetched | reviewed | c9a4e253d6bd |
| stealth-light-shadow | stealth | fetched | reviewed | 25d38cbc7f4c |
| stealth-peeking | stealth | fetched | reviewed | 289414d5ad34 |
| stealth-security-network | stealth | fetched | reviewed | 8c74c74d9494 |
| stealth-sound-lures | stealth | fetched | reviewed | e5f04ec91a8d |
| stealth-staged-accidents | stealth | fetched | reviewed | 36944c6a967d |
| stealth-synchronized-actions | stealth | fetched | reviewed | c8c0d22835da |
| survival-balanced-nutrition | survival | fetched | reviewed | 5d0975d767a8 |
| survival-bleeding-triage | survival | fetched | reviewed | 4770f829a40c |
| survival-body-inspection | survival | fetched | reviewed | 5ce917446763 |
| survival-competing-needs | survival | fetched | reviewed | 5297e7f325e4 |
| survival-contagion-control | survival | fetched | reviewed | ca9a9bb6caad |
| survival-fatigue-rest | survival | fetched | reviewed | b61d91e30d84 |
| survival-limb-impairment | survival | fetched | reviewed | 443308dcdb80 |
| survival-safe-water | survival | fetched | reviewed | 4230d8613fb2 |
| survival-stress-crisis | survival | fetched | reviewed | bc774ca5d5e8 |
| survival-temporary-relief | survival | fetched | reviewed | 4513607b9133 |
| survival-weather-exposure | survival | fetched | reviewed | 9dc5ed544dc2 |
| survival-wound-cleanliness | survival | fetched | reviewed | 1dff06b301fa |
