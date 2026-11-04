"""Author local Traditional Chinese notes from a cached public snapshot.

This maintainer tool is not part of the offline build. It does not copy upstream
images, case studies, or full pages. Source summary is a short paraphrase;
the remaining sections are local analysis or an unverified prototype.

The analysis sentences below are fixed templates. They are only a scaffold for a
source entry that has no note yet, so a generated note is marked `pending`.
The prototype says what to build and what passing or failing looks like.
驗收 and 邊界驗收 are built from that entry's rule, test, pitfall, and
decisions. They are not one sentence copied onto every note. They do not
invent counts, durations, thresholds, or step-by-step numeric scenarios.
``replace_acceptance`` rewrites only those two bullets. Notes stay `draft`
until a person checks them. This tool never writes `reviewed`.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from opencc import OpenCC

from glossary import GLOSSARY, TITLE_OVERRIDES

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = ROOT / 'patterns'
CONVERTER = OpenCC('s2twp')
PRESERVE = {
    'allocation-shop-reservation', 'automation-belt-routing', 'building-structural-support',
    'combat-stamina-budget', 'commerce-price-discovery', 'cooking-recipe-learning',
    'exploration-ability-gates', 'farming-growth-care', 'fishing-bite-window',
    'gathering-tool-hardness', 'inventory-adjacency', 'inventory-shape-packing',
    'puzzles-box-pushing', 'relationships-gift-allocation',
}
GLUE = {'為了', '或', '至', '作為', '基於'}
TAG_PRESSURE = {
    'planning': '必須先承諾，後果才會出現',
    'timing': '正確行動若離開窗口就會變成另一種失敗',
    'precision': '差一點點就會落到另一個結果',
    'risk': '收益與損失綁在同一個選擇上',
    'economy': '存量會改寫下一步還能做什麼',
    'spatial': '位置與相鄰關係本身就是規則',
    'information': '看得到的回饋仍要玩家自己解釋',
    'cooperation': '資訊或能力被拆到不同人身上',
    'progression': '這次選擇會留下之後還能用的能力',
    'creativity': '玩家要在約束裡組出來源沒指定的解',
    'optimization': '同一目標有多條成本不同的路',
    'time': '等待或時程本身就在消耗行動額度',
    'randomness': '結果有分布，不能背成固定腳本',
    'discovery': '探索會改變之後看得到的選項',
    'narrative': '選擇同時推進事件與關係',
    'dexterity': '操作精度會干擾策略判斷',
}
FAMILY = {
    'automation': '這類問題的關鍵是流量、阻塞與改線能不能被看見。',
    'building': '這類問題的關鍵是結構或空間規則先於外觀。',
    'combat': '這類問題的關鍵是一次進攻同時消耗之後的退路。',
    'exploration': '這類問題的關鍵是舊場景會被新能力重新解釋。',
    'movement': '這類問題的關鍵是路線與身體狀態一起決定能不能到達。',
    'stealth': '這類問題的關鍵是被發現的程度，而不只是有沒有被看到。',
    'cooking': '這類問題的關鍵是知識、材料與工序可以分開卡住。',
    'gathering': '這類問題的關鍵是看得到的資源仍可能受工具或環境限制。',
    'deckbuilding': '這類問題的關鍵是現在拿進牌組的東西會改變之後每一抽。',
    'cooperation': '這類問題的關鍵是沒有人同時握有完成任務的全部資訊或手段。',
    'defense': '這類問題的關鍵是在敵人到達前，把有限資源換成時間或路徑。',
    'progression': '這類問題的關鍵是這一次的承諾會跨過單場戰鬥留下。',
    'survival': '這類問題的關鍵是多種身體需求同時倒數，不能逐一清完。',
    'ecology': '這類問題的關鍵是個體選擇會改寫之後的族群或後代。',
    'allocation': '這類問題的關鍵是你拿走的選項會從別人的可行集消失。',
    'incremental': '這類問題的關鍵是現在不花的資源會改變下一輪的收入。',
    'commerce': '這類問題的關鍵是價格或訂單同時帶來收益與資訊。',
    'driving': '這類問題的關鍵是車身姿態與速度會決定下一個彎還能做什麼。',
    'matching': '這類問題的關鍵是這一步消除會留下下一手的盤面。',
    'narrative': '這類問題的關鍵是沉默、延遲或措辭本身就是選擇。',
    'projectiles': '這類問題的關鍵是移動、瞄準與開火可以拆成不同決策。',
    'rhythm': '這類問題的關鍵是做什麼與在哪一拍做是兩件事。',
    'command': '這類問題的關鍵是單位的順序與目標選擇比單次傷害更早決定勝負。',
    'farming': '這類問題的關鍵是成長時間會佔住之後的照料額度。',
    'fishing': '這類問題的關鍵是水下狀態必須先變成可判斷的訊號。',
    'inventory': '這類問題的關鍵是攜帶方式會改變物品的可用價值。',
    'puzzles': '這類問題的關鍵是這一步會同時改寫之後還能站的位置。',
    'relationships': '這類問題的關鍵是有限的社交資源要分給誰。',
}
NOT_FOR = {
    'automation': '不適用於物流完全隱藏、只結算最終產量的系統。',
    'building': '不適用於沒有支撐、覆蓋或工序回饋的自由堆疊。',
    'combat': '不適用於沒有回復窗口、純自動結算的戰鬥。',
    'exploration': '不適用於拿到能力後舊地圖再也不會回去的線性關卡。',
    'movement': '不適用於位移只是過場、不會改變下一個可達點的移動。',
    'stealth': '不適用於一被看見就立即結束、中間沒有可反應層級的潛行。',
    'cooking': '不適用於配方、材料與完成條件永遠綁成同一個按鈕的製作。',
    'gathering': '不適用於看見資源就一定取得得到的採集。',
    'deckbuilding': '不適用於卡組在對局中不會被選擇改變的固定牌表。',
    'cooperation': '不適用於所有人看到同一塊完整資訊的單人操作。',
    'defense': '不適用於敵人路徑與到達時間都不可改變的固定劇本。',
    'progression': '不適用於每一場結束都完全清掉、沒有任何承諾留下的結構。',
    'survival': '不適用於只有一種資源條、而且永遠不會互相排擠的生存。',
    'ecology': '不適用於繁殖或鄰近不會改變後代與族群的裝飾性飼養。',
    'allocation': '不適用於選項無限、拿走也不影響其他人的清單。',
    'incremental': '不適用於收入與花費沒有跨回合關係的單次購物。',
    'commerce': '不適用於價格公開、成交與否沒有任何資訊價值的標價。',
    'driving': '不適用於車輛只負責把鏡頭從甲地送到乙地的過場。',
    'matching': '不適用於消除不會留下新盤面、也不改變下一手的結算。',
    'narrative': '不適用於對話只是等玩家按繼續的說明文字。',
    'projectiles': '不適用於攻擊必定命中、瞄準不會改變結果的自動火力。',
    'rhythm': '不適用於輸入時機不影響成敗的動作。',
    'command': '不適用於單位會自己選目標、玩家只負責按下開始的戰鬥。',
    'farming': '不適用於播種後不需要再分配時間、成熟只是倒數的裝飾。',
    'fishing': '不適用於等待沒有可辨訊號、成功只看隨機骰的釣魚。',
    'inventory': '不適用於物品只佔一個數字、位置與形狀都不產生新決策的背包。',
    'puzzles': '不適用於任何順序都能到達同一終點、而且可以無成本重來的拼圖。',
    'relationships': '不適用於送禮或對話不會改變後續選項的好感度數字。',
}
PRESERVE_REASONS = {
    ('allocation-shop-reservation', 'inventory-shape-packing'): '兩者都在有限格子裡放棄一個未來選項；保留商品放棄的是下一輪貨架，形狀背包放棄的是之後還放得下的輪廓。',
    ('allocation-shop-reservation', 'commerce-price-discovery'): '保留是在資金不足時先佔住選項，價格探索是在成交與資訊之間報價；都能把「現在買不起或不確定」變成可管理的行動。',
    ('automation-belt-routing', 'building-structural-support'): '輸送路線與結構跨度都是空間承諾：先選一條路徑或一支點，之後才知道堵塞或崩塌出現在哪。',
    ('automation-belt-routing', 'farming-growth-care'): '改線與照料都是把等待中的產能重新分配；一邊看的是排隊，一邊看的是作物時程。',
    ('building-structural-support', 'automation-belt-routing'): '支撐不足與物流堵塞都是延後才爆開的空間失敗，讀回饋的方式不同，不能互相取代。',
    ('building-structural-support', 'puzzles-box-pushing'): '延伸結構與推箱子都會讓下一步的可站位置變少；前者看的是承重，後者看的是格子是否被自己封死。',
    ('combat-stamina-budget', 'fishing-bite-window'): '兩者都要求在窗口裡做一個難以撤回的動作；體力預算花的是後續退路，咬鉤窗口花的是這一次等待。',
    ('combat-stamina-budget', 'allocation-shop-reservation'): '多打一下與多留一個商品都是把未來的彈性拿來換現在的機會。',
    ('commerce-price-discovery', 'relationships-gift-allocation'): '報價與贈禮都用一次具體付出換取對方反應，重點是反應能不能指導下一次分配。',
    ('commerce-price-discovery', 'allocation-shop-reservation'): '試探價格與保留商品都處理「現在不確定值不值得承諾」；一個改變報價，一個佔住貨架。',
    ('cooking-recipe-learning', 'gathering-tool-hardness'): '配方知識與工具等級都是先看見目標、卻還差一層門檻才能完成。',
    ('cooking-recipe-learning', 'relationships-gift-allocation'): '學會配方與摸清偏好都是先取得知識，再決定稀缺材料或禮物要分給誰。',
    ('exploration-ability-gates', 'gathering-tool-hardness'): '能力門與工具門都讓玩家先記住一個去不了的地方，升級後再回來。',
    ('exploration-ability-gates', 'puzzles-box-pushing'): '回訪捷徑與推箱順序都依賴先前位置還在不在；一個用新能力重解舊路，一個用站位避免封死。',
    ('farming-growth-care', 'cooking-recipe-learning'): '收成提供材料，配方決定這些材料能不能變成新選項；兩邊的門檻不在同一步。',
    ('farming-growth-care', 'automation-belt-routing'): '田地擴張與輸送擴張都會把維護成本一起放大，不能只看單次產出。',
    ('fishing-bite-window', 'combat-stamina-budget'): '辨識訊號與分配體力都是在短窗口裡決定要不要把資源押上去。',
    ('gathering-tool-hardness', 'exploration-ability-gates'): '工具升級與能力解鎖都讓舊地點從「看得到」變成「進得去」。',
    ('gathering-tool-hardness', 'cooking-recipe-learning'): '新材料常是新配方的另一半條件；先有工具還是先有知識，會改變玩家先追哪一條線。',
    ('inventory-adjacency', 'inventory-shape-packing'): '相鄰加成與形狀裝填都讓背包位置產生價值，但一個看鄰居，一個看輪廓能不能放下。',
    ('inventory-adjacency', 'automation-belt-routing'): '相鄰連結與輸送路線都是在擺放之後才看得到阻塞或增益的網路。',
    ('inventory-shape-packing', 'inventory-adjacency'): '先解決放不放得下，才有資格談鄰居加成；兩層空間規則不要合成同一個提示。',
    ('inventory-shape-packing', 'allocation-shop-reservation'): '背包留白與商店保留都是為了之後的物品，先付出現在的空位。',
    ('puzzles-box-pushing', 'inventory-shape-packing'): '推箱與形狀背包都是在格子裡移動輪廓，差別是推箱還會擋住自己的站位。',
    ('puzzles-box-pushing', 'building-structural-support'): '錯誤的推動與過長的跨度都會把退路一起拆掉，而且失敗原因必須能讀出來。',
    ('relationships-gift-allocation', 'commerce-price-discovery'): '贈禮反應與顧客反應都是用一次付出換資訊，不能把單一個案當成全局真值。',
    ('relationships-gift-allocation', 'cooking-recipe-learning'): '禮物與料理都可能先卡在「知道對方要什麼」或「手上有沒有材料」。',
}


def hant(value: str) -> str:
    # OpenCC leaves ambiguous 里; in this corpus it means inside.
    return CONVERTER.convert(value).replace('里', '裡')


def steps_of(entry: dict) -> list[str]:
    return [hant(item['zh']) for item in entry['loop']]


def pattern_title(entry: dict) -> str:
    override = TITLE_OVERRIDES.get(entry['id'])
    if override:
        title = override
    else:
        parts = [GLOSSARY[token] for token in entry['id'].split('-')[1:]]
        parts = [part for part in parts if part not in GLUE]
        title = ''.join(parts)
    source_name = hant(entry['name']['zh'])
    if title == source_name or source_name.startswith(title) or title.startswith(source_name):
        title += '決策'
    if len(title) > 40:
        title = title[:40]
    return title


def card_summary(entry: dict, title: str) -> str:
    steps = steps_of(entry)
    text = f"{title}：從「{steps[0]}」走到「{steps[-1]}」，中間回饋必須改變下一個選擇。"
    if len(text) > 120:
        text = text[:120]
    return text


def short_rule(entry: dict) -> str:
    bits = [bit.strip(' ，') for bit in re.split(r'[；。]', hant(entry['rules']['zh'])) if bit.strip()]
    bit = min(bits, key=len) if bits else hant(entry['summary']['zh'])
    if len(bit) > 42:
        bit = bit[:42].rstrip('，、 ') + '…'
    return bit


def param_expectation(name_en: str, name_zh: str, steps: list[str], index: int) -> str:
    lowered = name_en.lower()
    focus = steps[min(index + 1, len(steps) - 1)]
    if any(word in lowered for word in ('window', 'timing', 'tempo', 'interval', 'beat', 'delay')):
        tight, loose = f'「{focus}」的可用時間變短', f'「{focus}」的容錯變大，判斷題可能變得太明顯'
    elif any(word in lowered for word in ('cost', 'penalty', 'price', 'budget', 'stamina', 'capacity')):
        tight, loose = f'走到「{focus}」的代價變高，玩家會更常保留資源', f'「{focus}」變便宜，玩家可能不再準備'
    elif any(word in lowered for word in ('contrast', 'precision', 'feedback', 'information', 'cue', 'variation')):
        tight, loose = f'「{focus}」的訊號變難分辨', f'「{focus}」的訊號變清楚，探索空間也變薄'
    elif index == 0:
        tight, loose = f'「{steps[0]}」之後更難進入「{focus}」', f'「{focus}」變容易，前面的準備可能失去重量'
    else:
        tight, loose = f'「{steps[-1]}」更常接不上「{focus}」', f'「{focus}」幾乎總能銜接，取捨會消失'
    return f'本地預期：把「{name_zh}」調緊時，{tight}；調鬆時，{loose}。先只動這個軸。這不是來源遊戲的實測參數。'


def related_reason(source: dict, target: dict, titles: dict[str, str]) -> str:
    key = (source['id'], target['id'])
    if key in PRESERVE_REASONS:
        reason = PRESERVE_REASONS[key]
    else:
        shared = [tag for tag in source['tags'] if tag in target['tags']]
        source_steps = steps_of(source)
        target_steps = steps_of(target)
        if shared:
            pressure = TAG_PRESSURE.get(shared[0], shared[0])
            reason = (
                f'共享的張力是「{pressure}」。「{titles[source["id"]]}」從「{source_steps[0]}」承諾，'
                f'「{titles[target["id"]]}」從「{target_steps[0]}」承諾，下一步分別走向「{source_steps[-1]}」與「{target_steps[-1]}」。'
            )
        else:
            reason = (
                f'「{titles[source["id"]]}」走到「{source_steps[-1]}」之後，常會碰到「{titles[target["id"]]}」的「{target_steps[0]}」。'
                f'兩邊的觸發條件不同，不能合成一個按鈕。'
            )
    if not reason.startswith('（本地分析）'):
        reason = '（本地分析）' + reason
    return reason


def source_summary(entry: dict) -> str:
    steps = ' → '.join(steps_of(entry))
    decisions = [hant(item['zh']).rstrip('？?') for item in entry['decisions']]
    summary = hant(entry['summary']['zh']).rstrip('。')
    return (
        f'以下是對公開條目的短篇改寫，只保留機制本身，不含案例、圖片或原站程式。\n\n'
        f'來源把「{entry["name"]["en"]}」定義成：{summary}。可對上的規則片段是：{short_rule(entry)}。\n\n'
        f'來源循環的順序是：{steps}。\n\n'
        f'來源要玩家自行權衡的兩件事，以下僅作繁體轉寫，不是本筆記的結論：「{decisions[0]}？」「{decisions[1]}？」'
    )


def problem_section(entry: dict, title: str) -> str:
    steps = steps_of(entry)
    pressures = '、'.join(TAG_PRESSURE[tag] for tag in entry['tags'] if tag in TAG_PRESSURE)
    return (
        f'「{title}」要處理的情況是：玩家已經能做「{steps[0]}」，但重複這個動作不會自動得到好結果。'
        f'{FAMILY[entry["system"]]}'
        f'這個條目同時壓在這些設計張力上：{pressures}。\n\n'
        f'適合放進玩家下一步會被「{steps[-2]}」改寫的系統。若結果在行動前就公布標準答案，這個設計問題會消失。'
        f'{NOT_FOR[entry["system"]]}\n\n'
        f'這裡的判斷是本地設計分析，不是來源作者的意圖，也不是案例遊戲的實驗結果。'
    )


def loop_section(entry: dict) -> str:
    steps = steps_of(entry)
    action = '、'.join(steps[:2]) if len(steps) > 3 else steps[0]
    feedback = steps[-2]
    nxt = steps[-1]
    return (
        f'- 玩家行動：承諾「{action}」。這一動是玩家主動付出去的部分，不能事後假裝沒有做過。\n'
        f'- 系統回饋：對該行動給出與「{feedback}」對應、而且能區分成功、部分成功與失敗的結果。只給一個總分不算回饋。\n'
        f'- 下一個決策：玩家依回饋決定要不要進入「{nxt}」，或改走成本不同的另一條路。若回饋不能改變這個選擇，循環就沒有學習價值。'
    )


def tradeoff_section(entry: dict) -> str:
    steps = steps_of(entry)
    names = [hant(item['name']['zh']) for item in entry['parameters']]
    decisions = [hant(item['zh']).rstrip('？?') for item in entry['decisions']]
    return (
        f'- 在「{steps[1]}」就給出還能不能回頭的資訊，讓玩家不必等到「{steps[-1]}」才知道「{decisions[0]}」這題選錯了。\n'
        f'- 「{names[0]}」用來回答第一個難點；「{names[-1]}」用來回答「{decisions[1]}」。兩個旋鈕如果綁在同一段回饋裡，玩家無法知道自己該改準備還是該改收尾。\n'
        f'- 「{steps[0]}」保留一條較穩的走法，「{steps[-1]}」保留一條收益或資訊更高的走法。兩條路的結果必須長得不一樣，否則這個機制沒有選擇。'
    )


def parameter_section(entry: dict) -> str:
    steps = steps_of(entry)
    lines = [
        f'- {param_expectation(item["name"]["en"], hant(item["name"]["zh"]), steps, index)}'
        for index, item in enumerate(entry['parameters'])
    ]
    lines.append('- 不要把上述旋鈕寫成某一款遊戲的官方數值。來源若提到調整方向，也只是編輯分析，不是實驗報告。')
    return '\n'.join(lines)


def failure_section(entry: dict) -> str:
    steps = steps_of(entry)
    primary = TAG_PRESSURE.get(entry['tags'][0], '這個選擇的代價看不清楚')
    rule = short_rule(entry)
    return (
        f'- 若玩家看不出「{steps[0]}」如何導致「{steps[-2]}」，就只會記住成敗。以這個條目來說，規則片段「{rule}」一旦不可觀察，學習就停止。這是本地失敗判斷，不是來源記載的實玩統計。\n'
        f'- 張力是「{primary}」。若介面沒有把這個張力顯示成不同狀態，「{steps[-1]}」會退化成固定手順。\n'
        f'- {NOT_FOR[entry["system"]]}在那種結構裡硬加「{steps[-1]}」，只會多一個沒有決策的動畫。'
    )


# s2twp turns 连接 into 連線 and 通过 into 透過. s2t/s2tw still rewrite 只能 as 隻能.
_CHECK_CONVERTER = OpenCC('s2tw')
_CLAUSE_FIXES = (
    ('隻能', '只能'),
    ('隻有', '只有'),
    ('隻剩', '只剩'),
    ('隻是', '只是'),
    ('隻要', '只要'),
    ('不是隻', '不是只'),
    ('還是隻', '還是只'),
    ('別隻', '別只'),
    ('，隻', '，只'),
    ('反饋', '回饋'),
    ('信息', '資訊'),
    ('複制', '複製'),
)


def _clause(text: str) -> str:
    text = _CHECK_CONVERTER.convert(text).replace('里', '裡')
    for src, dst in _CLAUSE_FIXES:
        text = text.replace(src, dst)
    return text.strip().rstrip('？?。；;')


def acceptance_checks(entry: dict) -> tuple[str, str]:
    """Pass and boundary lines from this entry's rule, test, pitfall, and decisions.

    The pass/fail framing is local analysis. The quoted clauses are the source's
    own wording. Nothing here is a sentence shared by every note.
    """
    rule = _clause(re.split(r'[。]', entry['rules']['zh'])[0])
    test = _clause(entry['prototype']['test']['zh'])
    pitfall = _clause(entry['prototype']['pitfall']['zh'])
    first = _clause(entry['decisions'][0]['zh'])
    passed = (
        f'- 驗收：（本地分析）對照來源規則「{rule}」。通過要能滿足「{test}」，'
        f'並分得出「{first}」。做不到就算失敗。'
    )
    boundary = _boundary_line(pitfall)
    return passed, boundary


# Ordering, scope, and “do this” pitfalls are guidance. The rest describe a failure.
_GUIDANCE = re.compile(r'先|不要|別|必須|避免|再|之前|延後|另做|應|初版|需要')


def _boundary_line(pitfall: str) -> str:
    """Check the pitfall as the source states it. Do not recast it as enter-versus-avoid."""
    if _GUIDANCE.search(pitfall):
        return f'- 邊界驗收：（本地分析）通過是原型照來源這句做：「{pitfall}」。'
    return (
        f'- 邊界驗收：（本地分析）直接測試來源描述的失敗：「{pitfall}」。'
        f'通過是這個失敗有清楚、可預期的處理。'
    )


def acceptance_text(entry: dict) -> str:
    """Short local prototype. Source counts stay inside the quoted first step."""
    joined = '、'.join(f'「{_clause(step["zh"])}」' for step in entry['loop'])
    first_step = _clause(entry['prototype']['firstStep']['zh'])
    passed, boundary = acceptance_checks(entry)
    return (
        '此原型尚未實玩驗證。下列通過與否是本地判斷。\n\n'
        f'- 最小範圍：（本地分析）做一個小場景，讓玩家依序經歷{joined}。'
        f'來源的原型第一步是「{first_step}」。\n'
        f'{passed}\n'
        f'{boundary}\n'
    )


_SCENARIO_LABEL = re.compile(r'^(?:最小範圍|驗收|邊界驗收|本地提案|基礎驗收)')


def kept_acceptance_lines(section: str) -> list[str]:
    """Keep an existing bullet only when it is not a numeric scenario."""
    kept = []
    for line in section.splitlines():
        if not line.startswith('- '):
            continue
        label = line[2:].split('：', 1)[0].split(':', 1)[0].strip()
        if _SCENARIO_LABEL.match(label):
            continue
        if re.search(r'[0-9０-９]', line):
            continue
        kept.append(line)
    return kept


def label_related_section(body: str) -> str:
    """The source lists related ids only, so any description is local analysis."""
    start = '## 相關模式\n'
    end = '\n## 參考來源\n'
    head, rest = body.split(start, 1)
    section, tail = rest.split(end, 1)
    lines = []
    for line in section.splitlines():
        if line.startswith('- [') and '：（本地分析）' not in line:
            line = line.replace(')：', ')：（本地分析）', 1)
        lines.append(line)
    joined = '\n'.join(line for line in lines if line != '').strip('\n')
    return head + start + '\n' + joined + '\n\n' + end.lstrip('\n') + tail


def replace_acceptance(body: str, entry: dict) -> str:
    start = '## 最小原型與驗收（本地提案）\n'
    end = '\n## 相關模式\n'
    head, rest = body.split(start, 1)
    old, tail = rest.split(end, 1)
    section = '\n' + acceptance_text(entry).rstrip('\n') + '\n'
    for line in kept_acceptance_lines(old):
        if line not in section:
            section = section.rstrip('\n') + '\n' + line + '\n'
    return head + start + section + end + tail


def prototype_section(entry: dict) -> str:
    return acceptance_text(entry).rstrip('\n')


def render_new_with(entry: dict, titles: dict[str, str], by_id: dict[str, dict]) -> str:
    title = titles[entry['id']]
    meta = {
        'schema_version': 2,
        'id': entry['id'],
        'title': title,
        'title_en': entry['name']['en'],
        'category': entry['system'],
        'source_category': entry['system'],
        'tags': list(entry['tags']),
        'summary': card_summary(entry, title),
        'note_status': 'pending',
        'related': list(entry['related']),
        'sources': [{
            'title': f'{entry["name"]["en"]} — Gameplay Atlas',
            'url': f'https://gameplayatlas.loopyhop.com/mechanic/{entry["id"]}/',
            'accessed': '2026-11-02',
            'access_method': 'page-text',
        }],
    }
    lines = [
        f'- [{titles[item]}]({item}.md)：{related_reason(entry, by_id[item], titles)}'
        for item in entry['related']
    ]
    url = meta['sources'][0]['url']
    source_title = meta['sources'][0]['title']
    body = f'''## 來源摘要

{source_summary(entry)}

## 問題與情境（本地分析）

{problem_section(entry, title)}

## 核心循環（本地分析）

{loop_section(entry)}

## 解法與取捨（本地分析）

{tradeoff_section(entry)}

## 可調參數（本地分析）

{parameter_section(entry)}

## 失敗模式（本地分析）

{failure_section(entry)}

## 最小原型與驗收（本地提案）

{prototype_section(entry)}

## 相關模式

{chr(10).join(lines)}

## 參考來源

- [{source_title}]({url}) — 查閱：2026-11-02；取得方式：page-text。
'''
    return '---\n' + json.dumps(meta, ensure_ascii=False, indent=2) + '\n---\n\n' + body


def core_from_existing(summary: str) -> str:
    match = re.search(r'核心循環：(.+)。', summary)
    if not match:
        raise ValueError('preserved note has no loop')
    steps = [part.strip() for part in match.group(1).split('→')]
    if len(steps) < 3:
        raise ValueError('preserved loop is too short')
    action = '、'.join(steps[:-2]) if len(steps) > 3 else steps[0]
    return (
        f'- 玩家行動：進行「{action}」。這是玩家在看到後果前就付出去的承諾。\n'
        f'- 系統回饋：讓「{steps[-2]}」變成可區分的結果，而不是只告知成功或失敗。\n'
        f'- 下一個決策：依據該結果選擇「{steps[-1]}」，或改走成本不同的下一步。回饋若不能改變這個選擇，就不構成循環。'
    )


def patch_preserved(path: Path, entry: dict, titles: dict[str, str]) -> None:
    text = path.read_text(encoding='utf-8')
    front, body = text[4:].split('\n---\n', 1)
    meta = json.loads(front)
    meta['schema_version'] = 2
    meta['source_category'] = entry['system']
    if meta.get('note_status') == 'reviewed':
        meta['note_status'] = 'draft'
    ordered = {
        'schema_version': meta['schema_version'], 'id': meta['id'], 'title': meta['title'],
        'title_en': meta['title_en'], 'category': meta['category'], 'source_category': meta['source_category'],
        'tags': meta['tags'], 'summary': meta['summary'], 'note_status': meta['note_status'],
        'related': meta['related'], 'sources': meta['sources'],
    }
    ordered['sources'][0]['access_method'] = 'page-text'
    if '## 核心循環（本地分析）\n' not in body:
        summary = body.split('## 問題與情境', 1)[0]
        block = f'## 核心循環（本地分析）\n\n{core_from_existing(summary)}\n\n'
        body = body.replace('## 解法與取捨（本地分析）\n', block + '## 解法與取捨（本地分析）\n', 1)
    body = replace_acceptance(body, entry)
    if entry['id'] == 'commerce-price-discovery':
        body = body.replace(
            '原站的搜尋索引摘錄描述：玩家提出售價，觀察顧客是否接受與其反應，再調整報價。核心循環：估價 → 試價 → 觀察 → 更新下一次選擇。此筆僅核對搜尋摘錄，未取得完整互動頁。',
            '公開頁面描述玩家為待售物訂價，觀察顧客是否接受以及情緒反應，再把觀察用於下一輪報價。較高價格提高單筆收益，也可能失去成交。核心循環：選品並估價 → 報出試探價格 → 觀察顧客反應 → 調整下一次報價。本次對照的是頁面內嵌的公開條目；先前精選版只核到搜尋索引摘錄，該限制已由這次直接取得取代。',
        )
        body = body.replace('取得方式：search-index-excerpt。', '取得方式：page-text。')
    for related_id in ordered['related']:
        reason = PRESERVE_REASONS[(entry['id'], related_id)]
        pattern = rf'- \[[^\]]+\]\({related_id}\.md\)(?:：.*)?\n'
        replacement = f'- [{titles[related_id]}]({related_id}.md)：{reason}\n'
        body, count = re.subn(pattern, replacement, body, count=1)
        if count != 1:
            raise ValueError(f'could not patch related link {entry["id"]} -> {related_id}')
    path.write_text('---\n' + json.dumps(ordered, ensure_ascii=False, indent=2) + '\n---\n' + body, encoding='utf-8')


def titles_for(entries: list[dict]) -> dict[str, str]:
    # Preserved titles stay. New titles are checked for collisions after.
    existing = {}
    for path in PATTERNS.glob('*.md'):
        if path.name == 'README.md':
            continue
        meta = json.loads(path.read_text(encoding='utf-8').split('---', 2)[1])
        if meta['id'] in PRESERVE:
            existing[meta['id']] = meta['title']
    titles = {}
    used = set(existing.values())
    for entry in entries:
        if entry['id'] in existing:
            titles[entry['id']] = existing[entry['id']]
            continue
        title = pattern_title(entry)
        if title in used:
            title = f'{title}（{hant(entry["name"]["en"][:12])}）'
        if title in used:
            raise ValueError('title collision ' + title)
        used.add(title)
        titles[entry['id']] = title
    return titles


def write_all(entries: list[dict]) -> None:
    by_id = {entry['id']: entry for entry in entries}
    titles = titles_for(entries)
    for entry in entries:
        path = PATTERNS / f'{entry["id"]}.md'
        if entry['id'] in PRESERVE:
            patch_preserved(path, entry, titles)
        elif not path.exists():
            path.write_text(render_new_with(entry, titles, by_id), encoding='utf-8')
    missing = [token for entry in entries if entry['id'] not in PRESERVE for token in entry['id'].split('-')[1:] if token not in GLOSSARY and entry['id'] not in TITLE_OVERRIDES]
    if missing:
        raise SystemExit('missing glossary tokens: ' + ', '.join(sorted(set(missing))))


def main() -> None:
    cache = Path('/tmp/atlas-cache/catalog.json')
    entries = json.loads(cache.read_text(encoding='utf-8'))
    write_all(entries)
    print(f'wrote notes for {len(entries)} entries')


if __name__ == '__main__':
    main()
