# 補救紀錄：公開樹中的主機資訊（2026-09）

- **日期**：2026-09-28
- **授權**：repository owner 於 2026-09-28 明確授權（「該改的都可以改，不能讓錯誤持續」），範圍含不可改寫的 `.team` 紀錄與 evidence 的遮蔽。
- **原因**：本 repository 是 public。說明文件與部分紀錄寫入了 operator 本機家目錄路徑、個人帳號前綴的 disposable 主機別名、KVM 主機名與主機上的暫存目錄，違反公開邊界。
- **做法**：只把上述主機資訊換成固定佔位字，不改其他內容：
  - operator 家目錄前綴 → `<operator-home>/`
  - disposable 主機別名 → `<disposable-0N>`（保留編號，文件仍能說明 01 是 core、02–04 是 worker）
  - KVM 主機名 → `<kvm-host>`
  - 主機上的暫存目錄前綴 → `<tmp>/`
- **不做**：不改寫 Git 歷史、不 force push、不處理 GitLab mirror；憑證輪替不在範圍（遮蔽的內容不含憑證）。
- **限制**：清理目前的樹**不等於**清除 Git 歷史或 mirror 中的舊內容；舊 commit 仍可讀到原值。
- **尚未處理**：`labs/eru-vps-mvp` 的程式碼與測試仍以 disposable 主機別名作為設定值與 fixture，屬於程式行為，另行處理。

## 受影響範圍

- 可修改文件（直接改為中性描述）：38 份，例如根 `.team/PLAN.md`、各元件 `HANDOFF.md`、`NEXT-PROMPT.md`、`labs/eru-vps-mvp/docs/`。
- 不可改寫紀錄（只遮蔽）：176 份，路徑前綴如下：

| 前綴 | 檔案數 |
| --- | ---: |
| `.team/reports/` | 64 |
| `.team/tasks/` | 24 |
| `platform/agent-platform/docs/evidence/` | 8 |
| `platform/ice-maker/.team/reports/` | 12 |
| `platform/ice-maker/.team/tasks/` | 7 |
| `platform/local-ocr-services/.team/tasks/` | 5 |
| `products/hai-taskboard/.team/reports/` | 51 |
| `products/hai-taskboard/.team/tasks/` | 5 |

## 引用舊雜湊的文件

下列可修改文件引用了被遮蔽紀錄的 SHA-256，已在文件開頭加註指向本紀錄；被遮蔽紀錄彼此之間的引用不改（它們是不可改寫紀錄），以下表對照。

- `.team/PLAN.md`
- `platform/dim-gate/docs/HANDOFF-WORKSPACES.md`
- `platform/dim-gate/docs/STATUS.md`
- `products/hai-taskboard/.team/PLAN.md`
- `products/hai-taskboard/.team/REVIEWER_REPORT_CONTRACT.md`
- `products/hai-taskboard/docs/HANDOFF.md`
- `products/hai-taskboard/docs/adr/ADR-005-sqlite-and-local-deployment.md`
- `products/hai-taskboard/docs/reproducibility.md`

## SHA-256 對照（遮蔽前 → 遮蔽後）

| 紀錄 | 遮蔽前 | 遮蔽後 |
| --- | --- | --- |
| `.team/reports/T-007-attempt-1.md` | `fac8d90d5cccaf1d07c6f247b29c2cc0a18ec322d93b2ac4dc38cb06ebb63ff9` | `70bf86a2a80bfbb4cd61d9b1b971218998435a94c702145bf9c7c6a921e0f8d0` |
| `.team/reports/T-008-attempt-1.md` | `e3c1f27e02cad7df09eafd5d6f7161673cf70912055ed6723d14db0adbb3dfa3` | `868545971efd98a351dff3fe0e4633a6238447a90871c7f21c71638ab36d1b92` |
| `.team/reports/T-010-attempt-1.md` | `9e989391134079c1a12840990a9fc33415d2b437566e3641c72a382e9ee1ecf4` | `e00aab482a1983209b965c01c749fc17bf01be8e1d4011924d71f73f48e47415` |
| `.team/reports/T-018-attempt-3.md` | `97f7cd57163a1f644f69356e006efb29c89be121ace03f7decc4f7e45a08d87c` | `4eee89ca33ea4f7a326710ead0c49b8504ab8a1fd16addcd6541e97c62698816` |
| `.team/reports/T-018-checkpoint-1.md` | `6b0013e207e4fcd568099794973d9d1e062cbd963c0fb6d797d8ceb214a18c20` | `af68bd88c2ffac6263f3cba7da19973d07fc31289c003e639338678ad22460fc` |
| `.team/reports/T-019-attempt-1.md` | `b45894619ac847cd2fd778c225585d6033eb1d9cfb0b89c322a2497cc5ce7fee` | `8252373926b86b13fbb175e89a64aca090675baaca428aa6adbecb59c5255b09` |
| `.team/reports/T-020-attempt-1.md` | `33b8002297da40c9dbe6dc9d19a7eb738e4b8e8f16a1afab6ec8b32dc68c18c0` | `a69a8c066ae66b9d0f1df1252e559f51e9f7e299f68d65f8d0e4e483ee082349` |
| `.team/reports/T-020-attempt-2.md` | `3c6aa269f2c564c28b345863545dff40ed9dd70a9d8b6e347baa0e0c8cb2c2fd` | `3fa7e83b867db54b079bc4a5724c98e6d1efdaa8516761eb0b0825e320c09f8e` |
| `.team/reports/T-020-attempt-3.md` | `79ae5d63f0e6fefc4594d2e80aa94175be2393648d502addf5de7c663013d52e` | `2e2e134499f3e183772fa85c75aece9b161ef3700bbe68b36d067cd0d214b1c7` |
| `.team/reports/T-021-attempt-1.md` | `dd94e0e0fdde5503762bc55b1bb2c8c53886806024b29b978f55f39c4d07ec8b` | `b4d7fe4a0129431c2c29922466944731d44ae4858f0970baf78072abec809c33` |
| `.team/reports/T-022-attempt-1.md` | `78bf5f6f9175150cab4bde122eadfb1d0678e1a499ae2b05623811a515b97095` | `43cc4eb9638e9b84c92d844920e1ec7ac7cdde253d029518686538e96b32125d` |
| `.team/reports/T-023-attempt-1.md` | `c8cc7f3b93323c14b17d0c1ce29010f5fefa90e9c66a55a5fae3ce3779c65922` | `7520a7da442b1bc139e5f100105d1e4a1b25660481136978a9f13a1e54111c09` |
| `.team/reports/T-024-attempt-1.md` | `6ca2f56696d86268b4b34f651964d0b4691977b4ed3c30b4c0e83f40182b9dbf` | `adc01520ade17d7d3aefba8b484acc71dc6475dad6ceae496698ce5e8fc45bd0` |
| `.team/reports/T-024-attempt-3.md` | `d2359561cc75a733ce7eb8132c20893756ac2ab13be342f88da47f406948deeb` | `17b41c0c7a54d6652f5a4c924002196d909b1b917833147287fb101008a5a7ce` |
| `.team/reports/T-025-attempt-1.md` | `86ce570aefc56f81c37ee85a0844773066bb5099fc7e7953fd31a47567e5eda4` | `d47b4a0a15e03464fd84e477849a38a6466329525fe0ffbe9b855d299374572d` |
| `.team/reports/T-026-attempt-1.md` | `7b4e66768219d615574c38dd9a0511fa0c94439e31875c91031f42793c2a5ad1` | `2560bbedd0881e5a78cf74268fd554107cdf98ae3d9146c01f44e024daaf8feb` |
| `.team/reports/T-028-attempt-1.md` | `5abc978c113f24ebf1d7d1503881bd558eb041be721b5b2001104cf4ea9aa821` | `43d1650d5efa614b76ee3df00d0dc32db2dcd524d042df64f78c43d025abf93e` |
| `.team/reports/T-030-attempt-1.md` | `e66a015803d19e6bdb9833b4984573d9e878606bc28aafe10b45b747ac98d0eb` | `752b6a4dd2b41ecf2f95178947ced86264b25a1cc8034feb3fe2aeea4cb14505` |
| `.team/reports/T-031-attempt-1.md` | `738b8c5dd07c37ad5eaaefe25bb86659fa1870a62ab6e3216080f8f32d14cfda` | `00bb3eccec159586cd1f3b2a517c515943a57397cfbe29c354d5de0016a1641b` |
| `.team/reports/T-031-attempt-2.md` | `116e4e0aed3382ef08f817a9a9603420fe56093534d375ce4018e5d92b0e7343` | `414914d3d2f8cb7925aaf0d08f509d1ec0229c8c02953b4ef55e964620209ee9` |
| `.team/reports/T-031-attempt-3.md` | `49ccb46c6906c54def37cb43688b18c9079bf13a23daa55596bb1fabf9ebf34f` | `2c3b15fa5ad299d9ff7f9eaea2563a14d32594268512d6a5085d6f0723c365e3` |
| `.team/reports/T-031.md` | `49ccb46c6906c54def37cb43688b18c9079bf13a23daa55596bb1fabf9ebf34f` | `2c3b15fa5ad299d9ff7f9eaea2563a14d32594268512d6a5085d6f0723c365e3` |
| `.team/reports/T-032-attempt-1.md` | `eb53ae6105a288e77fefd1d5c38e269d2a198d764128d40bda31cca33dc1d10a` | `846dec1456f4cff1d6d29e917636a55eb46a1cd4d4ff445766a812e815c96ec9` |
| `.team/reports/T-032-attempt-2.md` | `33ee9b1d02d0b88f29195ccaa281546471e3cf028b3dcd53cb1ad7b44f1fe6a8` | `6265d6b93032cd8c26a82414e96ad718e0a024c1969e226b191e92c9579d3b61` |
| `.team/reports/T-032-attempt-3.md` | `a49e5ce04f07d7870da66fb9afdfae7225b5ae67b472c1f0a5f1e46602bb918d` | `2a5155add5df2c2109c826888d1d50d70c37f115d827bba562c6193255ad40c9` |
| `.team/reports/T-032.md` | `a49e5ce04f07d7870da66fb9afdfae7225b5ae67b472c1f0a5f1e46602bb918d` | `2a5155add5df2c2109c826888d1d50d70c37f115d827bba562c6193255ad40c9` |
| `.team/reports/T-033-attempt-1.md` | `8b3f7e95e50b707e432a70d5c7a2fe849db2c97db9b108eac31004f87827416a` | `79219ebbccdd6893b0522c4efbfdb709c3dadf5907fb67937ff9ca3bb08e3414` |
| `.team/reports/T-033-attempt-2.md` | `0412ce70d8a8738f56958f2001ed745a7b2c7252a02079d7aea1de841debb054` | `e36cdbfc424c6e1c8ba7303f86a9798bb8d2a503df4dda9d70711dbe0bd5b232` |
| `.team/reports/T-033.md` | `2d0589c76a5001f829a7e2b6b14e618cfd484a36600e5043a31ac719aeb19a14` | `38cb1220fc9513d7fe618fec2fca653a518ff842665d191366897e45ac3850e2` |
| `.team/reports/T-034-attempt-1.md` | `a4ffdbfcc0a527dbebe4d78c84601a5859ed0f70c71d31ef027f37d1d0fe6a32` | `732ff878ea79ec2017dbdf9f026034a678cad917b0c4111b535a7ac024967a00` |
| `.team/reports/T-034-attempt-2.md` | `52e536ad7eb7d924e94d24c4f660e571cd62e536ea949836ad98c4ee0908e719` | `c90c90a10027823f967945c9e9a9fd7ae9f02a5a1ec899a2ad2d8d0270d0ab15` |
| `.team/reports/T-034-attempt-3.md` | `1bdf3e0ba5b9c371b601fa2086f6dcfa66ee850a7e234923d87503dcdcfbca16` | `436b85d053434805faee5091d33839c12fc8b89e85659b226556b1fb0ad1ecea` |
| `.team/reports/T-034.md` | `6adcec3965fde040e881a98a2358ad5383c1fbde147cebed45ec8b85de89a966` | `b5688caf2bedf45ed998c701d6d41e89c8392da66681ef7cf0984e20fc18158f` |
| `.team/reports/T-035-attempt-3.md` | `a31994231622040b1f8754c393ee978acbdf14c8ead92d7cc83242e97fa4bfba` | `d8ba6fdc84ef678c5b687a4187647ccf5478b2d0cffdf5b66a2ba67f69de0fb3` |
| `.team/reports/T-035.md` | `dbf7213ef493158526e350902079b96506bc77e0514f48e59430a59f175b364b` | `64852e1ef55ad7922ac374276dadcc0118af12aa6041f0f98a9f0df384d1aea2` |
| `.team/reports/T-036-attempt-1.md` | `c006bb83c9c5c0537367b22c5d8347c2c91ec2c91d099a0f0b55363fa361f591` | `7b00ded8f6cf1aef06252bb604cf70080e66555a982e4aad2735519dda25d6cb` |
| `.team/reports/T-036-attempt-2.md` | `372ae44d6ed11374a3f4b6bbc3df82b3994d27ea77f35868b00bf4c5fd5489f6` | `dee99311328963edaf1b3a637bc152c5368ed5f58f8b83815de1890789978980` |
| `.team/reports/T-036.md` | `372ae44d6ed11374a3f4b6bbc3df82b3994d27ea77f35868b00bf4c5fd5489f6` | `dee99311328963edaf1b3a637bc152c5368ed5f58f8b83815de1890789978980` |
| `.team/reports/T-037-attempt-1.md` | `9295dee30fed600e57f9a289a0f873f7c8e77a163bfb575bc0cecaee0030d372` | `a17af0cd4a8c5e53209ebd024a83f4193c720c7f9870cf691d851af96ef2f380` |
| `.team/reports/T-037.md` | `9295dee30fed600e57f9a289a0f873f7c8e77a163bfb575bc0cecaee0030d372` | `a17af0cd4a8c5e53209ebd024a83f4193c720c7f9870cf691d851af96ef2f380` |
| `.team/reports/T-038-attempt-1.md` | `bb7a1ea75f62a7d8b3e0ac449e61c1f1998df179ef19452e8d1f1c91882b1bcb` | `cab3fb39835ead8e1b46ba21f186a7b01d0e6cc28542cb7f6da7368ca4d43666` |
| `.team/reports/T-038-attempt-2.md` | `bb4ebb4212dcffb64963beaf91ad628bab997b558e00694a470ec035873822eb` | `e14df9da82207525b9b5052e226ba312c92836f515aae5c848824abd7282bbed` |
| `.team/reports/T-038.md` | `c3d8e1ed5453842584013b71a348a1c9805044f24b8786ca9f5646a287477b9f` | `7d16334c7f43c65b808a09d57b65879a8a62e5c8112d569da898de472f68f3ad` |
| `.team/reports/T-039-attempt-1.md` | `66adf1f7db762482c3efdc51f7f523f902443f95c900f0cb5702b8105082e933` | `dec39834241ff8a5810458a820cbbe8ae52c02c062a6c4731f166ffebe94de2d` |
| `.team/reports/T-039-attempt-2.md` | `bd9485a5a7491fa81d659fa95a4a4e81fa9b98c8214c9e730d492991a61d339f` | `dd802d2c58b55c20453076d45dceaa36bf760657e10f247048771aa1597424c8` |
| `.team/reports/T-040-attempt-1.md` | `e65a0fb0741db809351dc64cb836b25101fc2ce9861c593e36ab8b781c5c0d57` | `d9aadc674ec64871d548838bdbf0fda39b359a8fc1ac60f92965557986381da8` |
| `.team/reports/T-040-attempt-3.md` | `7ea43f6deff22007c01c7113df18b24351f064fb879a77fc63d6c700317f444f` | `319edfcbdf79ca83868a700e409e47975dd4adfddd59461089181711ee59ac5a` |
| `.team/reports/T-040-attempt-4.md` | `9274658eb769ff1a2273c3a7e9cd3761ffc39840c308f2cff7e6194201431825` | `0640b058f0d5c21162f2d638baab2e8a5e3491cc7a0abb257dcdebaaf7f5adcf` |
| `.team/reports/T-040.md` | `9274658eb769ff1a2273c3a7e9cd3761ffc39840c308f2cff7e6194201431825` | `0640b058f0d5c21162f2d638baab2e8a5e3491cc7a0abb257dcdebaaf7f5adcf` |
| `.team/reports/T-042-attempt-1.md` | `3e3b5c3be87bc81a92ea73de96422f6a28208eb16b5677a7bbd57b19b7082d84` | `e16ab12b05fefb9459eac872cb4e3ace756a73236349c49c309c4676cc5b7d8d` |
| `.team/reports/T-043-attempt-1.md` | `62dcc1b074e1399a2bf45624822111752877ea601362cf8e2b242d1c3fd95d42` | `0d5edc26af3746985b1d779e90cdc10be9fb8a6a18a2cd9bfba7b24eeecebb09` |
| `.team/reports/T-044-attempt-1.md` | `0ea0451f28a149063c627ada1f2de6ab3df5163c0341513518192e4eac65a42c` | `4a1d76e7a7f3e2f06884244ced4697b0b3132a215710d20a0e13eff0a426ff3c` |
| `.team/reports/T-044-attempt-2.md` | `552199643dc36b83261e03be8c84c9d632b45c7fea3e135add1872c8a9fddf39` | `185706f5dade647a176977c087c5f1b85037cb5e2c8a8756a106a160b8ef7934` |
| `.team/reports/T-044-attempt-3.md` | `866b5c6a7c335780cccad72ddf68a8ce1c874d78c6f1098ab55b272252394834` | `ae3b50fedb6079cf9323b31c622ba4b3c1236262a4eb312d2c11713460920b7d` |
| `.team/reports/T-049-attempt-1.md` | `394b5dc7173cee66a83abdd8f5ce7a2783be1e20b640241b831d8d564a63e824` | `949a62b93d52866dfb84fbfa6d4ad0d0f5af3ab4c20bf221025d51c209a30bf7` |
| `.team/reports/T-049-attempt-2.md` | `3db3320326ec57a63659620d994ffd810d385122b853782bb50cf2d8e6e23e92` | `fff62c667b4c01eaf1a80ffb71addf4bb57e77bee9e0991be578dde0d8a01d03` |
| `.team/reports/T-049-attempt-3.md` | `cde962168a39eba2c26a262a3ca2e828921c651d7b80829645a944d85d987909` | `fa7c31c3e6d88266ed4219e90e79270454a52ff3cb069d0a67990d591218f309` |
| `.team/reports/T-105.md` | `da8597198fb8a74a03c6386dd6c4ec0acf083c5de0ea0582bad9ae9ca1839576` | `c24ea1287fdbde5c6d86026a3e2172b066176935c7e4231a96e77800560b600f` |
| `.team/reports/dim-gate-m1-preflight.md` | `461039e34ee2ca3d45abf494ee4c15a36b44ac9428288462346cc9b7d8ca266d` | `118be1324e715c06a4f7d49476f716c189c1be2074aaa37bf96bcff54c6b3c91` |
| `.team/reports/dim-gate-m2-preflight.md` | `1f065b152fed9926f032c1fd9331ec1f2b9d0f1840ec432590cb54fc94f893b5` | `348c4123a719715fb95a25d1e0ea32ca83100b6814ddfafeeb0d0cbd462c28e5` |
| `.team/reports/dim-gate-w2-validation.md` | `0f746c72a87dd40db7714b2e6211b24aedb168448a0759ee5e471ccb08ff94e1` | `3096ecdcda1af62fecbe441c6178ef1ae00286909787cd5dab80ca67e11f73fb` |
| `.team/reports/dim-gate-w3-initial-review-checkpoint.md` | `e65a0fb0741db809351dc64cb836b25101fc2ce9861c593e36ab8b781c5c0d57` | `d9aadc674ec64871d548838bdbf0fda39b359a8fc1ac60f92965557986381da8` |
| `.team/reports/dim-gate-w3-review-ci-checkpoint.md` | `7048ea1989c5d96bde39926eaee4d96e0902151df6a27a8a8f57b1ce49071a52` | `de6fe5621f3adf19cd9349a1495081c5f11f8c11f225a81cbb1f52749515c5bd` |
| `.team/reports/dim-gate-w5-preflight.md` | `db788b31c46097e4f6560bbced1aa292e0aa8859cc6c5b0010f17089035d6eff` | `6a115143014d5f4c041be4cfe664d3d3cde30b2fd67691d7ef4cd97701557c93` |
| `.team/tasks/T-006.md` | `816736fc59fab535bfa11f92f6ac13f01df4370ba717406b7d421c577e41770d` | `9c919b2b031faa86729c3ed49287ba03f5bd7397d33e3982277893d76b5aa2a1` |
| `.team/tasks/T-011.md` | `ea5352d99a2bd7e555195b726132c7944724a4fece4f2ac5a1ffc50d4a9e6c59` | `16703e8a347ae81b9b43d77e2bf8e4653775ce861b73f7010b736da7eb2f3761` |
| `.team/tasks/T-013.md` | `495c15037fb4fdcbea4cc853209190a1a301ff1f854c9ea94a5f2fdcca903510` | `a1d56a304c0840cf313da1162aec435fe0f9436d06d5b791bdb466d59bd3c06e` |
| `.team/tasks/T-017.md` | `7c7328dc99bfde90fe246f16784054bb4a974b735a13a64daecd94ea737a938e` | `11814140c7c7fbb57700ec35d89af30ba5fda219bd5726096f7e6de99088378b` |
| `.team/tasks/T-018.md` | `deb91b779784a2a2a5b68bf67575b1c2e5aa2a45d8c58d5e30edcd4e63d6532a` | `96d8b306b5fb579660e34b7b6a3e19b96bd474418681388b94042af9fc30e5b5` |
| `.team/tasks/T-019.md` | `a398f93c363b97ebb80480ee9c1a542888f90fd1cc183cc1580c9533ace56710` | `c30de4fd625937a03cee42b9d64be85f1f273d61a1ea5b54b67d6252d001b75a` |
| `.team/tasks/T-020.md` | `64fb0cb0c98c6134a41e1b527633b5f3e0b0d574256cbd2cf592458e615c52d0` | `003de775b561ca4b8d20c4c2cf3ebb1cd1afb21b8ebf0afe4acb5cd8715e9dd8` |
| `.team/tasks/T-021.md` | `1d04829650ad6570de32463d4378f3c87d7f99ee0bdfd7ffddf2eb1d352d130e` | `2a50b762a8750971dfa0e91896c5415b083499414c5b8bb340e286e60ee7efe8` |
| `.team/tasks/T-022.md` | `57460c8c0482affc1902a418189b8aa8aaeb70d9855d9d0e37b1762fe8316ee9` | `542b43f076e0ccaebf61c5c84887dde11336068d7a65e6de04049ab5800937cb` |
| `.team/tasks/T-023.md` | `26e05c6354d48c75a62c92f135052eac4866d4295941315c05927e4db41fb114` | `de776dc473875de3a9fcdadffd32b4311a315052b3263959cf910e9276e89e57` |
| `.team/tasks/T-024.md` | `c40bb274d3955d2d8cff97d544bf2f2a86ae2c05fa8c6810e2306b6bc41073ae` | `1f68c17d54a3d2e8dc836d16598eeb3dd4e5ca882693e38e6285507695fa2631` |
| `.team/tasks/T-025.md` | `2145a0cd18cf891ae03bddc82ad3756c31f58b064d05c92a5f1595975e0fd61d` | `9cd349b08340db5070e33252be48788c738c78337ff4e4fa2ad8b1cb7445bf8d` |
| `.team/tasks/T-026.md` | `c71f22fb03bbeb48e54550fc541f3b82b5bcf7f54eeb5bc8b8478d33931218df` | `a91e2639d2d76d85ee26d8079bc2336959732aff81f995aac78ac0816e9ba2d9` |
| `.team/tasks/T-027.md` | `f405ca244433bb6c82c753720a91059149846cfdf32d0d83c9308f2ad74b52ad` | `8f748de840217fb2757fd1d817f860e299d3a9ffc819f7fb6be340bfcb631a78` |
| `.team/tasks/T-028.md` | `157f52e155dfd58eccd3e612f723f4e0005578b40ade93f6613b20f3d3e594ec` | `cc78fe0e4b202d9a401953c1aba3bc56fa08f8807fa79c45d958add578d07575` |
| `.team/tasks/T-029.md` | `8a396f7bb3c4d42542f3241d83cc2a67b7ccb19ada7862ff3c85e26e234efd6d` | `2d7c8c9a8014bdfb84e283d1880e6cd07a3fa2fc96c19c04690024de1b1fe740` |
| `.team/tasks/T-033.md` | `f97602af9c0c01cda3cf28037f6f4677a93a216401b92408bd0f5e9d535281f0` | `93f6ecf2868fe92e7a63d1615d01dfded0a9880023b5ccd2faa67b646e1c9992` |
| `.team/tasks/T-034.md` | `6b544eea5262019c71cd0cd2a32ccaa195cc19d72897921643c8a0bfba80bb51` | `2beb2d743d7c4cd21d750245049e1813b59dd0fb081e1bdf29b463d7698eadca` |
| `.team/tasks/T-035.md` | `bf735e440beb4b0af6373721f1dfc7b3ac6844e4b392a4095509856dbdec6111` | `c0cfb7efc2bd7504e0b2e0fd285ac64ef3d06a4bf527627a2df16c0680ab9c32` |
| `.team/tasks/T-036.md` | `c65bd9a301fafeeeed3e7b2a7a246c801d9fe191292394b7bb86b66272f13ad1` | `c87d5525bc2e3b846cc609aab827a20a4df088463cb6aa48d69164cdf9b2f588` |
| `.team/tasks/T-037.md` | `fcc4d1ec8c8ccc2c507a1f787456bf0613e24914386c2611216507596c43a90f` | `dd1c5cb3a402f82ea9d25ba38cdda977cd7cac42220f9121eb59aa5dfd397b38` |
| `.team/tasks/T-038.md` | `a2a1f757a252140c25ef9c653f8626e3adc27b9f160d550d7b91adf61d3f2cd1` | `12d8e233d698267fa929e5bc939aaccabc20c7baa070e2d07fc279881970e14b` |
| `.team/tasks/T-039.md` | `809024a4b37fbbb38ca53094aac9cf953e030edd68ac467cec379591ffc3eeb7` | `23ae61ea14652d78b6107f06f4fddae6013334150827e112e36eb53a7b5e1816` |
| `.team/tasks/T-040.md` | `29be78e0449fc91f920e1453ffec627e169ee9d2bd5814533caba9dbf74a0ebe` | `88a315c9d06874e948cfb23bfe2ecf32f5ffba425a988c2024ab042d250070f7` |
| `platform/agent-platform/docs/evidence/kvm-cocoon-config-2026-09-21.json` | `6a8f91eeb84e217e3ae7a0ada6f661445893a1da4d90b2362a559241b893ac44` | `70f92bcd67751efe50090b4ccb5b3fac46222562ab1e5e159d07cabd9848ed33` |
| `platform/agent-platform/docs/evidence/kvm-lifecycle-2026-09-21.json` | `eb468f66b27d9ee62e10a9d61f181f3dc4d3d86c22a3b4f26c26aa4700602305` | `c4550328a6106bc5df7836ead7e774a68842a8b3a822fd406ef3eba533c10666` |
| `platform/agent-platform/docs/evidence/kvm-node-config-2026-09-21.json` | `3d983c79d37185f6422211857499b8a2fd9d12acc62bc315ee9f3c60c8884399` | `e755cc80cb66b5d3fdc2383743d9629b005d95b7f26941a7130e88ad9881166b` |
| `platform/agent-platform/docs/evidence/m2-card-kvm-2026-09-27.json` | `9d00d4b17b27553ac1a302ec8afa2a298f5a81584d76f01e59d4f8147776f4bb` | `6ce69e332d073c63beac5aabade0c84d38626c7aa6f6107b00769840cfc7e395` |
| `platform/agent-platform/docs/evidence/m2-kvm-2026-09-22.json` | `0782290e9933c641ac16d80b8f0cde3ef9e61c3746b49bf0af90ebca57f0be7d` | `15dc153240f375401d812ae392a93110a07cf5d8a34c79fde7a28dd474e7064b` |
| `platform/agent-platform/docs/evidence/m3-m2-regression-2026-09-22.json` | `6f834aba80a926d6b1a5e42012d23c147da05736611355dd56b52577d20db1b3` | `f65ff088ca81e8b6b64dbb996698a9c84ae85ed4700cff6bb394f813f6f6a0f5` |
| `platform/agent-platform/docs/evidence/m3-openai-mock-2026-09-24.json` | `929dc513b109b502b56f4340c50444b58865cfa67ac118bf59597b37846c6f20` | `9834c866c3ceaa9d2542ac1bc6cf8038739873400fbac4a6de2c90fb27dd67e8` |
| `platform/agent-platform/docs/evidence/new-host-2026-09-21.md` | `8c977864c322025686b419fa21fed0c5e4a6b6603f3885e9fe872ed06b5ba379` | `da305ea0cbde8e37612dc1643336099ce490a1b1d2b547a9f7a363437d690a88` |
| `platform/ice-maker/.team/reports/T-001.md` | `790b7f3d9bb8ccc3614d2529cf845757dccac1105996880f4dae54306e8e5424` | `9ce1c0424127759c0eafe0888d626f4944e75248b34277a3262b0d818406b289` |
| `platform/ice-maker/.team/reports/T-007.md` | `6dc57c11f9f1df424da20f58aca6954b693b6210364814ad67483d4eba5f171d` | `87f8c63c36115fca711c572d8c1e48da6bf1abf7b494a3015f0e3c1a6a9898e7` |
| `platform/ice-maker/.team/reports/T-014.md` | `8cd03ed3a53b49d3a4cf4e5cf057bd5d98b580fe360809218fc338e3530fcfbd` | `a1967fb9d984ca63c2e431e2014d1e47d5822de8f30b7428ea6f9d88ceebcc74` |
| `platform/ice-maker/.team/reports/T-016.md` | `c13887fae680b9636f1eb222bd48627e49e550bd51e065ec412f6fd2f3a76604` | `556857e9bf865443dc71fa241a8e52afd01680b013b46be672e4e4a6b095d32b` |
| `platform/ice-maker/.team/reports/T-017.md` | `4cc4443810f8e77ec1da406c2b8d34f5b65edb74ef44bc841ab23fbd3b5217b8` | `865f822e5156c7937366b43434587e78f784209f251e4cbeffa4a6c6513e75b8` |
| `platform/ice-maker/.team/reports/T-019.md` | `5dc3fc3c8d407ba0885e82b020bfd3e50fe6e05a1f63e2b61d70eea93b94fa4d` | `7bd33eb4a52146296c22de83d2995f906e76400dab81cc14bfbbf8fff9c44537` |
| `platform/ice-maker/.team/reports/T-021.md` | `e6f1241492f1f5198e653c141a6521e51bed347708f17483ef556cbbbe04b9d6` | `45966d1329fc3a263fdb675655315978f707d2358a9765821e691a895ab289e8` |
| `platform/ice-maker/.team/reports/T-022.md` | `3c767766879f1650a1d9327cba32c7c37dd5c35e768d97b849b4794c276adfed` | `7f8f30f829c4413fd87d927932aed7e3640c8272e37688fe30f86ea6cc3c3776` |
| `platform/ice-maker/.team/reports/T-024.md` | `19534c434fb83ea315f537b9846e03c5bea52c9a8ca05c8a5d80656da11770c4` | `9a58690cab6a84becda9906fe559e52b7cc3ddf94b9d45bb2649053ba801f71b` |
| `platform/ice-maker/.team/reports/T-035.md` | `69bdce5588cf3791e71536ed3f52149797f10f63eb39a63cfaca0776b8af5f07` | `cf1977783c31d11e16e114e01f60419a1497fa21d8dfd8875467c133829d3dc7` |
| `platform/ice-maker/.team/reports/T-036.md` | `b955a959fbf9cf2dc711dbe74212ed7e6d40f74c2355265e163067e7b94c32a6` | `5002605aa2fd6265f2a51bad4c90af18edf4d54f92ee73867036fd8d4ed9faa0` |
| `platform/ice-maker/.team/reports/T-037.md` | `eaf242df8abca669a526a53215c8fc55628c7db193712ce4632e2e7c306780d2` | `99f48149bfef806b81d9edb18d1487b495e4917205a33e164de4416d82496425` |
| `platform/ice-maker/.team/tasks/T-027.md` | `d514d21bb421e9fe62d436f9a56c20044865dfeae818fceca764a44622e17d07` | `37d4a704db16e630be5c4e0c459f9b537ca19f37a20ea33f79055aa1c193b525` |
| `platform/ice-maker/.team/tasks/T-035.md` | `37210b3eb4f9f8df01f3c0a6dd57744b9dc530b020b58aea8e09f31e8a3cac2b` | `119856505e47096ec27ea71bf5369bd218136a4918979526ef8d6302a2aa5b7b` |
| `platform/ice-maker/.team/tasks/T-036.md` | `282977671da15118e5b86d73d1430e695f56814a027e896b29e38a7f311bc5ce` | `5d97c7a3f8159cdaf86b8fdef1e83202cfc626f105ce185a742890abef3ae4c7` |
| `platform/ice-maker/.team/tasks/T-037.md` | `2eb447ad0f5a6272db7a3d415ce20bc1043e537d8b306dfd2e9a23f5eea41542` | `64ae2a263905686ad46a112ff61a8b964c396313ebcfec0a96bb7d78c1fc7c4f` |
| `platform/ice-maker/.team/tasks/T-038.md` | `cb1a3e26458afc83336ed26f7431b0f496f038db46e10e9ab4b31ebbf8982e61` | `b0214730087c156b0eaa6513246ec5817e50c5a725b38641f66fa64052ed9bfd` |
| `platform/ice-maker/.team/tasks/T-039.md` | `1371720ec81779da494433a6a4b5a4b36db3c1f67c7e421554550f0a374c739c` | `5c79c0d447c648ec55d89c3eb1f88d3083212901cf8f9e640736020905e4aa54` |
| `platform/ice-maker/.team/tasks/T-040.md` | `0001da9f17b3276c5e7113bd9638f276229cdb4c16e3f382feab2658c49ca696` | `08a9a59072e06d49211ddb2a0c4620af1041dbdbb7f274280c5bf5e03cde8304` |
| `platform/local-ocr-services/.team/tasks/T-001.md` | `c86c8d1f69e887f03aef42ccad56167ce07d3e0aa44882be03bbaaba6af6c0dc` | `881539bf1ab95361aa0494c9ed03383f1c9e32cff28ab5b6fa8954d8c929ba68` |
| `platform/local-ocr-services/.team/tasks/T-002.md` | `9722cc26510f58bf94f246ce94463f6e95b23eae3c51c6145cccabcd3ceb6191` | `f77052a3c8faef95fce2e644811f787f9593946b41691ca2088babc9c80a413b` |
| `platform/local-ocr-services/.team/tasks/T-003.md` | `620c41f4a46fe87984b900399030c402e7dac73a769473ce99504317abf0b395` | `f271d72a22156063b7ecd593ded2b7d5917240d911ab45a631de44826f62ad1d` |
| `platform/local-ocr-services/.team/tasks/T-004.md` | `a4d25a8d11e4da58ec2cedad852d8e430460349182715bdf78f5f765a3cda4d5` | `d41fb5736075b4a422b884ea7bba4b0933d424cbafaf608eb3979840e6659a29` |
| `platform/local-ocr-services/.team/tasks/T-005.md` | `28bb3dc5af43082626d605b67d59a2a53fc8706ccd243a246d0020c86701e88b` | `33a010469e1ed508d8432a676bd59831ae1a7eaa003c8cf1d92eb28f5213aded` |
| `products/hai-taskboard/.team/reports/T-001.md` | `27250c73595a515e9985131c1e258e4a22d67a8eb451e2638ad73c2ed338d6db` | `62f25a0bee0e070f67026ca65f7222dd220b185494b99639dd105ff5b91ec1ae` |
| `products/hai-taskboard/.team/reports/T-004.md` | `c0cc1978642d671e0692e735b4981faf86df1da9986f279e01711522389d58ea` | `0fb5cede1e0b905f14650e9d1696900d1f0c1f91530bae32b12ed33a018bb93f` |
| `products/hai-taskboard/.team/reports/T-011.md` | `25f52053643dfb2ad9c12bf3dff6475eb8588e09a9c7a5d13bd53141841522f7` | `c9b228ae9442230bf67d9deeae2fc192aed6ebd8bc06c8e1d1f74776e002c492` |
| `products/hai-taskboard/.team/reports/T-012.md` | `879f5c81de176fcdd81ddab124dcb314d6d64b37f394690d1bb137f1dbecac2b` | `c02fece5458b6656f2a77a49178afde7ca4b3d1b7a77da5cf1c87876c4231a00` |
| `products/hai-taskboard/.team/reports/T-013.md` | `0db20bdab8a8c085d3adbed1589dce5540cf5063711d7be1c5c33a6c0108e5da` | `fb9dbe95f7b212518284fee790af24f970194991bc931c6cce29903affbe2a33` |
| `products/hai-taskboard/.team/reports/T-020.md` | `e7c7b18240127ecc7baa6a9d45c560d7e6c9ff6a450eca11fa3afbbe8795d3d1` | `1f3c3ce33eec501b2364dc9e3f8d1644f4990c97b9e2aaeb6c6df905e7f329a1` |
| `products/hai-taskboard/.team/reports/T-022.md` | `d69bdb8ed28f1729b3806a81df7b8275b5927d512cd0f3167aab1bce0d047f85` | `eba3a759b4716e03a5ff9d70a13dbb34d93999e36a71081375309c3cd5c9ca7e` |
| `products/hai-taskboard/.team/reports/T-023.md` | `bec1c433d5539af86ad4bacebf8342484ca81030f1baa63f162c8eef101d5440` | `ed5d33e071ff0accdce719862ae0d3a9acf920cc109bf87149a60b95189a37f0` |
| `products/hai-taskboard/.team/reports/T-024.md` | `309a209287a54454e1b713f56cc34e531654c333c92954cf19fa26f94e351967` | `e08934556dee2b32113d2db6dfd10811f1ab886a4ad35dd9647e6cf56492e0b9` |
| `products/hai-taskboard/.team/reports/T-030.md` | `2829e300bea58a18163140deeb336877ccf8570d04608d03cbec3c647d5c4791` | `358f4a13e8be8a99bf42923ad3f5ed45a3f12d9b6bac462394146e57cc5417ea` |
| `products/hai-taskboard/.team/reports/T-032.md` | `e21aaee9621172339242b053f8d98cc544f14c9f5a2826bda1a0425bdf8231fe` | `2d384ae488499e51ab2157d189421254a9994556e5a1b4275e21e2c04cde1646` |
| `products/hai-taskboard/.team/reports/T-041.md` | `6f4652babe1fb269325a2e1e43dd12b5e0c0c95e0516848e3e99f09e31919e1d` | `e3e2617dcdf18450ce1caa759f386dd4f04ce0322e05c08545ae62d969f0ef99` |
| `products/hai-taskboard/.team/reports/T-043.md` | `9198c2e58d8f33486c68b779c07f86bb8b810c52c6dc9f8ad3ea84fb652e23fe` | `bcd87855cddcee10c1f54731a9447bcae62f9ee6094cc7e0f7d2ca79f78a650a` |
| `products/hai-taskboard/.team/reports/T-044.md` | `e7e2b87447c1ec6f0b454574e6dff69aeb4d8fb2ea8837aa71301810f2609575` | `23ecb1345c963a7ffa9ac4762a16dc67fa21d6a5b42787088288aeb1c130c538` |
| `products/hai-taskboard/.team/reports/T-045.md` | `4ab2d7c2678d433867ae78f2d1e9893254b21bad910f5eaee1a0bd6eaae32705` | `1b2cf589e9c00334f4abc439a95e2b4da0c941e344747f8cb4ac8a2a5948c2e2` |
| `products/hai-taskboard/.team/reports/T-046.md` | `ce50447a48405fddc1db79b2b9b277063f43befc572b38a0d2d03318cd711f00` | `c9f4c2b6ba7acfdf71195c96facfecadda806ce2989464758306baf10906d614` |
| `products/hai-taskboard/.team/reports/T-047.md` | `5a47910d0600f0d7ecd40bf5da05d7ac9e5cd7d837716166e731d6072c00f064` | `5a8570c7e390938a84c29052f89b20bdc341253d039db33e6e7cc5200b4eb1eb` |
| `products/hai-taskboard/.team/reports/T-048.md` | `0219105eab65b7ac30cc6933f33176f80eec6c2ba169dfd4ccba04e4c8962325` | `dd5f587d86e1897a071062a6a8f172d1779346b44e35a013829e84e37f2212cc` |
| `products/hai-taskboard/.team/reports/T-051.md` | `ea587c0b86538a0731de1e879cf585ba63259b91661ad988b8672fd91b8d61ef` | `aa4f3292bb8622a3256d582826e3b094da88ef3b08549edbbdd777f0a95ba815` |
| `products/hai-taskboard/.team/reports/T-053.md` | `f984aac52ea00022c0de3aeb573c158294686a5aad85cf281a801e9e728797ad` | `09793708eb44f8e15e510e9360a76a6c7406995d69d92c40ecbfea55a1e843d6` |
| `products/hai-taskboard/.team/reports/T-054.md` | `7c11a63198b68ac120e23aa690e51fcea507da1ff7ade5df71ad5a448356126b` | `a2bfa64c2e836cf6631374dfff20a2798753522b9a73e4b78584d40831c435c8` |
| `products/hai-taskboard/.team/reports/T-056.md` | `e78dc9a0806e017a2902f7627409ecea1fa5bc7faf829cd106ef32930adc38c8` | `23c4f5aead847fcee50727fca7328e35b413c5fb1b59203fd4c9e7652cc7144f` |
| `products/hai-taskboard/.team/reports/T-057.md` | `37b18b7980f27e8d71ff27847dc9f17fc212155075cac22845598cd0ca27c094` | `dfcdc50e961a6035be04f6052cd9571974152522adf07e6ee1f7631ed1b32def` |
| `products/hai-taskboard/.team/reports/T-058.md` | `a97086b7b5f3435a1b07c7ac37976e257c938d1982b8d7ddcf11dc3cddd6006a` | `c991888108a69323921f9b6b8e8d47add20878d2018a1a21baa62f925f2d85f7` |
| `products/hai-taskboard/.team/reports/T-061.md` | `593eb2c547e1c361ee356d3c228d5e45bbfbac71cdd8967c189c1f48e7a0cab8` | `0f2795454c2e08191aae952f224a2e6be7ee7f2b63a2c5fd98aced121146c491` |
| `products/hai-taskboard/.team/reports/T-062.md` | `df9adfd90d1a3e72ade61f6ea98736680ce77c826a63c9a11b7607d5324829f4` | `9ef32eaf3a503d54836859101aaa2a253adc0cb31ed9fb561db881414fc6f037` |
| `products/hai-taskboard/.team/reports/T-063.md` | `38513b1da78d531dce50abb888529c38fd3ef5f08dfe8ee5de1d23a648517744` | `155f59638493af098c2b244a9f745edadbf2d2b7f11fe7c78af3727a0169e029` |
| `products/hai-taskboard/.team/reports/T-064.md` | `bdd7bfd9522d1cc7e488823ef3e3151b9852c1f036f9b8b9c7fd37f4e984dd8e` | `637e894c653f774fc94afe71fd3b0c00d9b939fc3ea75618134e739c6ebf02df` |
| `products/hai-taskboard/.team/reports/T-065.md` | `fe49ad687ea743756bdba037fd7211f06883a6f8cfb3ca4a24aca5cdfc5fb7ec` | `8f01be5f1c1a549600741052728dd630b1973cf2f5b00020fe2f3c3b997d43f3` |
| `products/hai-taskboard/.team/reports/T-066.md` | `a41772e9a835edb1255b4dc46ab85a198431f45b7ae5adc263aa055f0ced4c6e` | `7c1fdc4b0e6a61bc6b2f645d690b680a5e681599bc8ed5e5d2ad7955c4fc9978` |
| `products/hai-taskboard/.team/reports/T-067.md` | `9ac88514c6a875d0ab1fa13897dd97a9a311054c1e86c41671db8d82d5241fa2` | `ee79138dcdf4fba8be0b3796da4e0394cdcf233db8305f99fd60619e92a11d12` |
| `products/hai-taskboard/.team/reports/T-068.md` | `883f9bc841cf4e630ac4cf70ab77be6e23609dfb82a22a8894c7634486f04f34` | `eb63acfa6eafe5c486f2c8273148ecbb751ae075611db8c3d8853a2393544ce5` |
| `products/hai-taskboard/.team/reports/T-070.md` | `d25e52491c003f49d6450da2a6225eea2567bb04b498fa49e6eacf4963046bca` | `2cf8602b98897cceeec91fa54b18c9760c58b5db4113b5535d68591fc850cc91` |
| `products/hai-taskboard/.team/reports/T-073.md` | `390fe5dd13049b4f8e68fc4471840e6330bef8493cfe8dd4e9c16f9b6882d8ec` | `a37cb448fb2daa3449a7771525ad958cbbbc16c9e419ad94e6bcee3068701be4` |
| `products/hai-taskboard/.team/reports/T-074.md` | `41489bfb70b6b1cce3252877f23406ba097f192578e7d5913e01e5dfc783e366` | `35ef117ce17f3b9b0ef51093144e37ea10ba911de4c4c3c5363724ad513cb096` |
| `products/hai-taskboard/.team/reports/T-075.md` | `b6fcf2a40ce0d8d23accfbdd746c62d9531ac9a574af0b89c5a182f92c946b1c` | `b7127fa7b2ed263c6da8f59f808ccc81c45084a80253122ee5175756dc75969e` |
| `products/hai-taskboard/.team/reports/T-076.md` | `14a3e6832fdad1680173d7b6c05a2cfadd5d45107e66da8d984a204d64b33aaa` | `58338e7093ce37b7f4c605b54dce955c40615cdaa122cb7fd69d52e2dbce5f78` |
| `products/hai-taskboard/.team/reports/T-077.md` | `230aa4abce221e5bca0601377c3eec87b1db24992eb1ad1677aead066c9ab944` | `c4750a82f010aa9abc8eb46344a1324e6aa2fcaa6149a24f1925c357273d3d79` |
| `products/hai-taskboard/.team/reports/T-078.md` | `21d2929e084f1aea32b6ea26f546922b63c5616474eea3da18e3cafb6ed1a9a1` | `e49a6098d91bfda1860aa24f4af6dd80379169db1236c980bea0c7a4c87582d5` |
| `products/hai-taskboard/.team/reports/T-079.md` | `84e01d1b3f6a150841dc7a7e358157f9c991844d0b781dbfd01fbdbd818b8e68` | `587fea3db0a0bc23afd0873134e8b62be8325083a7ae525c252d1313e4e010ba` |
| `products/hai-taskboard/.team/reports/T-080.md` | `22bf843b930b9bcbff9a750c880d226778266dca40a7b8645909d1f92102eae0` | `87071696cd1af8dbaea19d3f15baa867f9a3506e99640ba39c89b73ef69e7e84` |
| `products/hai-taskboard/.team/reports/T-081.md` | `6b5aedcefe6f0e466ab05869761038f8f27768f847652a8903debe754ba4e9eb` | `607b03ab8b1269429b3d40f71af2b2fc916868389cc8140486b48da8b192b0ce` |
| `products/hai-taskboard/.team/reports/T-082.md` | `cacfed101ba6ac56d5a62943ef76f3cd494e3b86b7de40d598d82eb776e151ab` | `5f7309e56d6825787471974766c9eb8a00417471b12e522151a104650cd584b5` |
| `products/hai-taskboard/.team/reports/T-083.md` | `652164d5df82d79ec004163fa6a216e1e1a9af4fc0a97f404cf86ff83a6275a5` | `45ee2d52b9e9579abf8b98a002ec940206df6cb53e457c4482e063937ac751d0` |
| `products/hai-taskboard/.team/reports/T-084.md` | `3916da8ef9d9a9f746018bb4c100c8dee4d5d329940dcf40651eb8b33d902fe3` | `7e9ed23dece380fa756446a68b8f3f7b4041e2ff68a34ff5a0005cd9540755e0` |
| `products/hai-taskboard/.team/reports/T-085.md` | `829fa9fbea0e37c15300d58e0988a6d092dd51dff0c1a7eeaa2427eaef430c47` | `2d6c7f97411af8ba288e1715e5c0ab95c2c56e1dc23eaa4d1321e26840630185` |
| `products/hai-taskboard/.team/reports/T-086.md` | `a5dfc67709983871ab4042a825d9b8bbf5e425cc296723afab58cd715bf15b23` | `4e33e95eb98eb1ec281024c7eb62a57355e56d0988fdbfccba9dfaea2de5e22b` |
| `products/hai-taskboard/.team/reports/T-087.md` | `5aba83869ed8030a04ef2b2fda1680a780fc6205998826a0001fea8f813b3eb9` | `29964ef8eb57c360fd0c8376ef05b82ecfa95b8e9de519c21b0b925b33ebac12` |
| `products/hai-taskboard/.team/reports/T-088.md` | `1556eb34c160efc8655475572d094bcb705dd6487fb6595b74eb8ed3808d6368` | `677ed1cc68020ebb34ecbe6bc8c45635ebdab8e14fbb8201feb0fbe4728d6509` |
| `products/hai-taskboard/.team/reports/T-092.md` | `461629aec0376aecb2b1d9e1c9ce6d8c328f0837fb659673c550dce357cb6d5f` | `af12613b95c056bf498feb6c258813ae2819c04d3dfe5ea2afda5ee90c9101db` |
| `products/hai-taskboard/.team/reports/T-094.md` | `bce386d1146ecf3c37fa3eef74854a452fd4eff33056b57e8be62e15fd027cac` | `d641330844ce1d80ac71796db0314cee90d148b1dc44e096ba5b456b9882c603` |
| `products/hai-taskboard/.team/tasks/T-001.md` | `0688e1842e5178bb0f87a8ac5a9d355998913efdb6ccc212aae117938780cc5e` | `80614357ade35490e40b3a698d587b50aae37319326f067f123ae501b945b8d9` |
| `products/hai-taskboard/.team/tasks/T-002.md` | `06f417cac895937a915b3ccb3c8a3593e246aef223ac85f3ecfd710398dc77c9` | `4e1dc3cc682d9acc5e4f65239cb49f2f7a0582fd67ee2485e12b0645f8a750c7` |
| `products/hai-taskboard/.team/tasks/T-003.md` | `3a24279513f10bf4a81babec5a8fd21eb3fffb8d5e85410484a459f6df041fa3` | `e7e4e46730d5d88b820d30874df0f1fd407885d91e31ef1e8c8e1eaa05f846b4` |
| `products/hai-taskboard/.team/tasks/T-047.md` | `8f755c77a27820a0e5645bf8768ed594eca3b5acbd1de18b9c22c89961976187` | `5279581eac61a855a39a532c3564c9183f21e24329e06e01c814e1756d2d3022` |
| `products/hai-taskboard/.team/tasks/T-091.md` | `4ee76ec51997b8eff787bc420cf4d14379d8d5a773856093c3e632c16733e957` | `495093d7c2cfd3695c21f066b6ab8992a181e9dcdbe19d2c499e899147b00a50` |
