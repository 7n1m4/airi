/**
 * Model Expression Noise Gate
 *
 * Deterministic classifier that filters out low-level face-tracking channels
 * (ARKit 52 FACS, speech visemes, procedural eye-look/blink channels, neutral poses,
 * and numeric indices) and routes wardrobe mesh toggles, leaving sanitized
 * high-signal expressive morphs for UI display and LLM curation.
 */

export type ExpressionCategory
  = | 'arkit'
    | 'viseme'
    | 'procedural_eye'
    | 'neutral'
    | 'wardrobe'
    | 'emote'
    | 'unclassified'

// ---------------------------------------------------------------------------
// Noise Taxonomy: ARKit 52 FACS Primitives
// ---------------------------------------------------------------------------
const ARKIT_52_CANONICAL = [
  'eyeBlinkLeft',
  'eyeBlinkRight',
  'eyeLookDownLeft',
  'eyeLookDownRight',
  'eyeLookInLeft',
  'eyeLookInRight',
  'eyeLookOutLeft',
  'eyeLookOutRight',
  'eyeLookUpLeft',
  'eyeLookUpRight',
  'eyeSquintLeft',
  'eyeSquintRight',
  'eyeWideLeft',
  'eyeWideRight',
  'jawForward',
  'jawLeft',
  'jawOpen',
  'jawRight',
  'mouthClose',
  'mouthDimpleLeft',
  'mouthDimpleRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'mouthFunnel',
  'mouthLeft',
  'mouthLowerDownLeft',
  'mouthLowerDownRight',
  'mouthPressLeft',
  'mouthPressRight',
  'mouthPucker',
  'mouthRight',
  'mouthRollLower',
  'mouthRollUpper',
  'mouthShrugLower',
  'mouthShrugUpper',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthStretchLeft',
  'mouthStretchRight',
  'mouthUpperUpLeft',
  'mouthUpperUpRight',
  'browDownLeft',
  'browDownRight',
  'browInnerUp',
  'browOuterUpLeft',
  'browOuterUpRight',
  'cheekPuff',
  'cheekSquintLeft',
  'cheekSquintRight',
  'noseSneerLeft',
  'noseSneerRight',
  'tongueOut',
]

const ARKIT_SET = new Set(ARKIT_52_CANONICAL.map(k => k.toLowerCase()))

// ---------------------------------------------------------------------------
// Noise Taxonomy: Speech Visemes & Phonemes
// ---------------------------------------------------------------------------
const VISEME_KEYWORDS = [
  // Standard VRM presets
  'a',
  'i',
  'u',
  'e',
  'o',
  'aa',
  'ih',
  'ou',
  'ee',
  'oh',
  'ah',
  'a2',
  'a3',
  'ao',
  'ea',
  'ii',
  'uu',
  'oo',
  // Japanese kana visemes
  'あ',
  'い',
  'う',
  'え',
  'お',
  'ワ',
  'わ',
  'ん',
  'む',
  'へ',
  '口_あ',
  '口_い',
  '口_う',
  '口_え',
  '口_お',
  'エー',
  'えー',
  'ああ',
  'いい',
  'うう',
  'ええ',
  'おお',
  'ああ２',
  'ああ2',
  'いい２',
  'いい2',
  'うう２',
  'うう2',
  'ええ２',
  'ええ2',
  'おお２',
  'おお2',
  'ああ左',
  'ああ右',
  'ん2',
  // Oculus / Salsa phonemes
  'sil',
  'pp',
  'ff',
  'th',
  'dd',
  'kk',
  'ch',
  'ss',
  'nn',
  'rr',
  'f',
  'm',
  'mu',
]
const VISEME_SET = new Set(VISEME_KEYWORDS.map(k => k.toLowerCase()))

// ---------------------------------------------------------------------------
// Noise Taxonomy: Procedural Eye, Brow, Mouth & Rig Bone Channels
// ---------------------------------------------------------------------------
const PROCEDURAL_EYE_KEYWORDS = [
  'blink',
  'blink_l',
  'blink_r',
  'blinkleft',
  'blinkright',
  'eyeblink_l',
  'eyeblink_r',
  'blinkl',
  'blinkr',
  'lookup',
  'lookdown',
  'lookleft',
  'lookright',
  'look_up',
  'look_down',
  'look_left',
  'look_right',
  'look up',
  'look down',
  'look left',
  'look right',
  'eye_look_up',
  'eye_look_down',
  'eye_look_left',
  'eye_look_right',
  'brows up',
  'brows down',
  'brow up',
  'brow down',
  'brows_up',
  'brows_down',
  'brow-up',
  'brow-down',
  'eyebrow up',
  'eyebrow down',
  'browcurve',
  'brow_curve',
  'browaway',
  'browsaway',
  'brow-push',
  'brows-pull',
  'cheek-puff',
  'cheek_puff',
  'eye-dark',
  'eye_dark',
  'eye-small',
  'eye_small',
  'eye-half',
  'eye-open',
  'eye-close',
  'checkmove',
  'skinteeth',
  'skinteethl',
  'skinteethr',
  'eyeclose',
  'eyeclose1',
  'eyeclose2',
  'chin-smooth',
  'eyehighlighthide',
  'mthsmall',
  'mthlarge',
  'mthbad1',
  'mthbad2',
  'mthbad3',
  'face_young',
  'jaw-left',
  'jaw-right',
  'i-teeth',
  'i_teeth',
  'iteeth',
  'eyes',
  '上',
  '下',
  '口角上げ',
  '口角下げ',
  '高低眉',
  'face',
  'camera_look',
  'cheak-puff',
  'chhek-puff',
  'highlight_enlarge',
  'highlight_erase',
  'eyehighlight_erase',
  '目閉じ',
  '瞳サイズ調整',
  '擴瞳',
  '縮瞳',
  'bigblink',
  'puffycheeks',
  'blink_shape',
  'auto_blink',
  'extra_cheek',
  'extra_cheek2',
  'extra_cheek3',
  'click',
  'カメラ目線',
  '上右',
  '上左',
  '下右',
  '下左',
  '前',
  '前右',
  '前左',
  '口上',
  '口下',
  '右口角上げ',
  '右口角下げ',
  '左口角上げ',
  '左口角下げ',
  '寄せ',
  '寄せ右',
  '寄せ左',
  '横伸ばし',
  '横潰し',
  '横窄め',
  '歯消し',
  '下顎歯消し',
  '縦潰し',
  '口柳広げ',
  'fix_hand',
  'teeth_short',
  'e_blank',
  '歯を隠す',
  '上歯を隠す',
  '口左',
  '口右',
  '下角度',
  '左右',
  '左左',
  '右右',
  '右左',
  '間右',
  '間左',
  '内左',
  '内右',
  'highlight_down_l',
  'highlight_down_r',
  'highlight_rotate',
  'highlight_scale',
  'kubire',
  'sobokin',
  'tanima',
  'tenoko',
  'b_l',
  'b_r',
  'b',
  'tojime',
  // Japanese MMD standard eye morphs
  'まばたき',
  'ウィンク',
  'ウィンク右',
  'ウィンク２',
  'ウィンク2',
  'ウィンク２右',
  'ウインク',
  'ウインク右',
  '瞳小',
  '瞳縦',
  '光下',
  'ハイライト消し',
  '瞳大',
  '瞳右',
  '瞳左',
  '瞳上',
  '瞳下',
  '見開き',
  '目細め',
  '下まぶた',
  '上まぶた',
  '黒目',
  '口横広げ',
  'ハイライト拡大',
  'ハイライト消',
  'ｳｨﾝｸ',
  'ｳｨﾝｸ右',
  'ｳｨﾝｸ２',
  'ｳｨﾝｸ２右',
  '下まぶた上げ右',
  '下まぶた上げ左',
]
const PROCEDURAL_EYE_SET = new Set(PROCEDURAL_EYE_KEYWORDS.map(k => k.toLowerCase()))

// ---------------------------------------------------------------------------
// Base / Neutral / Raw Index Noise
// ---------------------------------------------------------------------------
const NEUTRAL_SET = new Set([
  'neutral',
  'default',
  'base',
  'none',
  'standard',
  'normal',
  'basis',
  'custom',
  'preset',
  'extra',
  'extra1',
  'extra2',
  'extra3',
  'extra4',
  'extra5',
  'extra6',
  'extra7',
  'extra8',
  'sub1',
  'sub2',
  'sub3',
  '基本セット',
  '基本set',
  '素体',
  'base_shape',
  'basis_shape',
  'reset',
  '默认',
  '初期セットアップ',
  'def',
  'off',
  'small',
  'mth_default',
  'mth_neutral',
  'm_neutral',
  'wait',
  'vroidhud',
  '動作チェック',
  'ease_pose',
])

// ---------------------------------------------------------------------------
// Wardrobe & Mesh / Prop / Toggle keywords
// ---------------------------------------------------------------------------
const WARDROBE_PATTERNS = [
  /glasses/i,
  /uniform/i,
  /jacket/i,
  /dress/i,
  /costume/i,
  /prop/i,
  /accessory/i,
  /toggle/i,
  /hair/i,
  /hat/i,
  /shoes/i,
  /socks/i,
  /sweater/i,
  /skirt/i,
  /shirt/i,
  /options/i,
  /preset \d/i,
  /color/i,
  /off on/i,
  /on off/i,
  /clothes/i,
  /pigtails/i,
  /holding/i,
  /hood/i,
  /mask/i,
  /tail off/i,
  /ears off/i,
  /swimsuit/i,
  /underwear/i,
  /bra off/i,
  /panty off/i,
  /coat/i,
  /dance/i,
  /色\d*/,
  /bangs/i,
  /braid/i,
  /bun/i,
  /ponytail/i,
  /twintail/i,
  /ahoge/i,
  /ribbon/i,
  /bow/i,
  /ring/i,
  /necklace/i,
  /horns/i,
  /halo/i,
  /wings?/i,
  /weapon/i,
  /sword/i,
  /gun/i,
  /boots/i,
  /outfit/i,
  /pixel\s+/i,
  /show(guitar|mic|stand|hand|prop|item|hat|sword|gun|ears)/i,
  /breast/i,
  /boobs/i,
  /hips/i,
  /pussy/i,
  /naked/i,
  /nude/i,
  /ear_elf/i,
  /elf_ear/i,
  /snowflake/i,
  /snow/i,
  /hide/i,
  /nightgown/i,
  /barefoot/i,
  /bag/i,
  /body/i,
  /tits[-_]/i,
  /nipple[-_]/i,
  /swimunder/i,
  /sticker[-_]/i,
  /日焼け/,
  /beret/i,
  /crown/i,
  /ヘッドセット/,
  /鍵開け/,
  /torch/i,
  /wand/i,
  /r18/i,
  /lift bra/i,
  /kimono/i,
  /cloth/i,
  /acce\d*/i,
  /syokusyu/i,
  /swim[-_]slide/i,
  /undies[-_]/i,
  /pin[-_]/i,
  /pin$/i,
  /frill/i,
  /maid/i,
  /道具-/,
  /天气-/,
  /动效-/,
  /裙摆/,
  /\[skin\]/i,
  /結ぶ/,
  /ケープ/,
  /杖/,
  /裾/,
  /dog ears?/i,
  /show ears/i,
  /tail_set/i,
  /ローレライ/,
  /エビフライ/,
  /頭出す/,
  /high heel/i,
  /マスク/,
  /素足/,
  /角\d*$/,
  /dogear/i,
  /kitsune/i,
  /plushie/i,
  /hold/i,
  /衣领/,
  /袖口/,
  /[换換][装裝]-/,
  /马尾/,
  /卷发/,
  /身体$/,
  /smooth_(arm|kotsuban|kurubushi|sune)/i,
  /^\w+_(off|on)(\.[lr])?$/i,
  /^(bikini|nightie|panty|top|bottom|skirt|shoes|socks|gloves|bra|outfit|acc|choker|sleeves)[-_]/i,
  // Japanese hair & wardrobe
  /三つ編み/,
  /ツインテール/,
  /ロングヘア/,
  /団子ヘア/,
  /ショートヘア/,
  /ポニーテール/,
  /ボブ/,
  /しっぽなし/,
  /耳なし/,
  /コート/,
  /水着/,
  /靴下/,
  /リボン/,
  /ダンス/,
  /下着/,
  /パンツ/,
  /ブラ/,
  /前髪/,
  /後髪/,
  /横髪/,
  /アホ毛/,
  /あほ毛/,
  /ポニテ/,
  /ツインテ/,
  /衣装/,
  /服/,
  /着物/,
  /メガネ/,
  /眼鏡/,
  /サングラス/,
  /帽子/,
  /靴/,
  /ブーツ/,
  /タイツ/,
  /ソックス/,
  /ピアス/,
  /イヤリング/,
  /ネックレス/,
  /指輪/,
  /腕輪/,
  /ブレスレット/,
  /ブローチ/,
  /アクセ/,
  /へそ出し/,
  /セーラー/,
  /ショール/,
  /パーカー/,
  /スカート/,
  /袴/,
  /なし$/,
  /あり$/,
  // Chinese hair & wardrobe (Simplified & Traditional)
  /制服/,
  /睡裙/,
  /眼镜/,
  /眼鏡/,
  /衣服/,
  /外套/,
  /帽子/,
  /鞋子/,
  /发型/,
  /髮型/,
  /饰品/,
  /飾品/,
  /显示/,
  /顯示/,
  /隐藏/,
  /隱藏/,
  /头发/,
  /頭髮/,
  /前发/,
  /前髮/,
  /后发/,
  /後髮/,
  /侧发/,
  /側髮/,
  /呆毛/,
  /裙子/,
  /裤子/,
  /褲子/,
  /上衣/,
  /内衣/,
  /內衣/,
  /内裤/,
  /內褲/,
  /泳装/,
  /泳裝/,
  /比基尼/,
  /袜子/,
  /襪子/,
  /丝袜/,
  /絲襪/,
  /手套/,
  /项链/,
  /項鍊/,
  /耳环/,
  /耳環/,
  /戒指/,
  /手镯/,
  /手鐲/,
  /翅膀/,
  /尾巴/,
  /兽耳/,
  /獸耳/,
  /光环/,
  /光環/,
  /武器/,
  /素体/,
  /像素眼镜/,
  /裸/,
  /眨眼耳/,
  /背饰/,
  /背飾/,
  /切换/,
  /切換/,
  /长发/,
  /長髮/,
  /短发/,
  /短髮/,
  /短袖/,
  /眼罩/,
  /勺/,
  /白发/,
  /白髮/,
  /无袖/,
  /無袖/,
]

// ---------------------------------------------------------------------------
// Known Emote / Expression patterns (Positive Match Signal)
// ---------------------------------------------------------------------------
const EMOTE_PATTERNS = [
  /joy/i,
  /angry/i,
  /sorrow/i,
  /fun/i,
  /surprised?/i,
  /happy/i,
  /sad/i,
  /smug/i,
  /pout/i,
  /blush/i,
  /cry/i,
  /tears?/i,
  /hearteyes?/i,
  /stareyes?/i,
  /dizzy/i,
  /shock/i,
  /wink/i,
  /smile/i,
  /confused?/i,
  /fear/i,
  /disgust/i,
  /sleepy/i,
  /relaxed/i,
  /tsundere/i,
  /embarrass(ed)?/i,
  /scare(d)?/i,
  /cool/i,
  /pleased/i,
  /excited/i,
  /panic/i,
  /flustered/i,
  /annoy(ed)?/i,
  /rage/i,
  /depressed/i,
  /despair/i,
  /cheer/i,
  /silly/i,
  /serious/i,
  /nervous/i,
  /kiss/i,
  /tongue/i,
  /tongue-out/i,
  /doya/i,
  /dere/i,
  /gao/i,
  /speechless/i,
  /exclamation/i,
  /bulb/i,
  /dark/i,
  /zzz/i,
  /heart/i,
  /hart/i,
  /sweat/i,
  /ahegao/i,
  /hmpf?/i,
  /hehe/i,
  /hah/i,
  /chill/i,
  /nihihi/i,
  /awawa/i,
  /jitome/i,
  /sarcastic/i,
  /scornful/i,
  /perplex/i,
  /stars?/i,
  /cat/i,
  /bunny/i,
  /doggy/i,
  /falls/i,
  /mouth [△^▲▽▼Λ∧]/i,
  /triangle/i,
  /slaver/i,
  /duckmouth/i,
  /duck_mouth/i,
  /fang/i,
  /v-mouth/i,
  /w-mouth/i,
  /mouth_w/i,
  /mouth_cat/i,
  /mouth_bunny/i,
  /mouth_v/i,
  /mouth_smug/i,
  /mouth_pout/i,
  /mouth_smile/i,
  /mouth_frown/i,
  /mouthtrouble/i,
  /trouble(d)?/i,
  /pale/i,
  /pissed/i,
  /shout/i,
  /gloomy/i,
  /white_eyes?/i,
  /smirk/i,
  /wow+/i,
  /wicked/i,
  /nagomi/i,
  /aori/i,
  /teethbare/i,
  /teeth bare/i,
  /teeth_bare/i,
  /aozame/i,
  /sekimen/i,
  /kirakira/i,
  /bored/i,
  /loading/i,
  /anya/i,
  /ehh/i,
  /eyeless/i,
  /doubt/i,
  /dumbfounded/i,
  /slobbery/i,
  /shy/i,
  /determined/i,
  /gritting_teeth/i,
  /laugh/i,
  /mufufu/i,
  /roundeyes?/i,
  /scowl/i,
  /shaking/i,
  /hau/i,
  /a-lup/i,
  /worry/i,
  /drool/i,
  /bero\d*/i,
  /bikkuri/i,
  /giri/i,
  /gizagiza/i,
  /_hn(_|$)/i,
  /nicori/i,
  /nii/i,
  /uwa\d*/i,
  /yaeba/i,
  /caret/i,
  /frustrated/i,
  /gasp/i,
  /grin/i,
  /grunt/i,
  /roar/i,
  /sigh/i,
  /curl/i,
  /wa_mouth/i,
  /poker/i,
  /mousew/i,
  /ネコ顔/,
  /exp_xd/i,
  /xd/i,
  /broken/i,
  /挑発/,
  /にっ/,
  /whot/i,
  /tired/i,
  /mouth wry/i,
  /siitake/i,
  /akire/i,
  /kurozame/i,
  /guruguru/i,
  /bou$/i,
  /blood/i,
  /basic_(blankface|oo|w|yay)/i,
  /huan\d*$/i,
  /gununu/i,
  /guhe/i,
  /nihe/i,
  /exlc/i,
  /ghost/i,
  /rainy/i,
  /rainbow/i,
  /temper/i,
  /battery/i,
  /spiral/i,
  /sparkle/i,
  /thunder/i,
  /yarn/i,
  /doteye/i,
  /bad/i,
  /evil/i,
  /sceptical/i,
  /adore/i,
  /mad/i,
  /stupid/i,
  /gloat/i,
  /peaceful/i,
  /exhausted/i,
  /anger/i,
  /arrow/i,
  /wha{2,}t/i,
  /desire/i,
  /pinwheel/i,
  /lines?/i,
  /question/i,
  /shadow/i,
  /mouse_ω/i,
  /mouth_ω/i,
  /mouse[-_]∞/i,
  /v字嘴/i,
  /波浪嘴/,
  /x[-_\s]*eyes?/i,
  /music/i,
  /love/i,
  /tere/i,
  /raised_brow/i,
  /sorry/i,
  /despise/i,
  /[小大]?x[-_\s]*眼/i,
  /\(warai\w*\)/i,
  /\(kanasi\w*\)/i,
  /\(ikari\w*\)/i,
  /\(odoroki\w*\)/i,
  /\(jito\w*\)/i,
  /\(komari\w*\)/i,
  /\(kusyo\w*\)/i,
  /\(urei\w*\)/i,
  /\(tan\w*\)/i,
  /\(run\w*\)/i,
  /\(driven\w*\)/i,
  /\(shy\)/i,
  // ASCII / Emoticon / Kaomoji
  /^-_-$|^>_<|^\^_\^|^\^o\^|^\^w\^|^xp\d*$|^:3$|^;w;$|^x$|^o_o$|^0_0$|^t_t$|^q_q$|^xd$|^▲(_\d+)?$|^△(_\d+)?$|^▼(_\d+)?$|^▽(_\d+)?$|^[Λ∧]$|^ロ$|^ω|[>＞][_\-ーwワ]*[<＜]|◯_◯|^oo$|^><$|^[?？!！]+$|^＾$|^□\d*$/i,
  // Japanese anime emotes
  /ドヤ/,
  /どや/,
  /生意気/,
  /恥じらい/,
  /うるうる/,
  /死んだ目/,
  /あせり/,
  /恐れ/,
  /白目/,
  /照れ/,
  /怒り/,
  /悲しみ/,
  /悲しい/,
  /困る/,
  /にやり/,
  /なごみ/,
  /びっくり/,
  /キリッ/,
  /ｷﾘｯ/,
  /じと目/,
  /ジト目/,
  /じと眉/,
  /ぐるぐる/,
  /はぅ/,
  /ハート/,
  /はぁと/,
  /なみだ/,
  /赤面/,
  /照れ/,
  /青ざめ/,
  /汗/,
  /キス顔/,
  /ベロ出し/,
  /叫び/,
  /叫ぶ/,
  /笑い/,
  /怒/,
  /哀/,
  /楽/,
  /ギザ歯/,
  /八重歯/,
  /べー/,
  /ぺろ/,
  /ぷくー/,
  /むっ/,
  /すまし/,
  /はんまき/,
  /へにょ/,
  /ぐる目/,
  /涙/,
  /にこ/,
  /ニコ/,
  /にこり/,
  /にっこり/,
  /真面目/,
  /にへら/,
  /はちゅ目/,
  /一文字/,
  /悲しむ/,
  /敵意/,
  /頬染め/,
  /がたがた/,
  /きらきら/,
  /くいしばる/,
  /にひひ/,
  /^[ハぷ]([左右]|\d+)?$/,
  /ムカッ/,
  /ムッ/,
  /むふ/,
  /むふふ/,
  /丸目/,
  /わぉ/,
  /恐ろしい子/,
  /喜/,
  /驚/,
  /喜び/,
  /睨む/,
  /絶望/,
  /んふ/,
  /はわ/,
  /目無し/,
  /でれ/,
  /おどろき/,
  /憂い/,
  /キッ/,
  // Chinese anime emotes (Simplified & Traditional)
  /大哭/,
  /爱心/,
  /愛心/,
  /星星眼/,
  /猫猫嘴/,
  /貓貓嘴/,
  /流汗/,
  /生气符号/,
  /生氣符號/,
  /瞌睡/,
  /问号/,
  /問號/,
  /感叹号/,
  /感歎號/,
  /无语/,
  /無語/,
  /阴沉/,
  /陰沉/,
  /心碎/,
  /惊吓/,
  /驚嚇/,
  /震惊/,
  /震驚/,
  /箭头眼/,
  /箭頭眼/,
  /[xｘＸ]_?眼/,
  /音乐/,
  /音樂/,
  /圈圈眼/,
  /脸红/,
  /臉紅/,
  /泪河/,
  /淚河/,
  /心动/,
  /心動/,
  /星星/,
  /线条/,
  /線條/,
  /灯泡/,
  /燈泡/,
  /吐舌/,
  /鼓脸/,
  /鼓臉/,
  /白眼/,
  /斜视/,
  /斜視/,
  /咬牙/,
  /微笑/,
  /大笑/,
  /悲伤/,
  /悲傷/,
  /生气/,
  /生氣/,
  /惊讶/,
  /驚訝/,
  /困惑/,
  /兔子嘴/,
  /脸黑/,
  /臉黑/,
  /星目/,
  /v字嘴/,
  /波浪嘴/,
  /省略号/,
  /省略號/,
  /眩晕眼/,
  /眩暈眼/,
  /狗狗眼/,
  /音符/,
  /风车/,
  /風車/,
  /歪嘴/,
  /抓狂嘴/,
  /桃心眼/,
  /半睁眼/,
  /半睜眼/,
  /笑眼/,
  /嘟嘴/,
  /方块嘴/,
  /方塊嘴/,
  /眼-(钻石|貓眼|猫眼|爱心|愛心|星星|严肃|委屈|消失)/,
  /嘴-(v|猫嘴|貓嘴|波浪|嘟嘴|方块|方塊|下箭头|上箭头|兔子|可爱|抓狂|猫猫)/i,
  /龇牙/,
  /齜牙/,
  /猫猫眼/,
  /貓貓眼/,
  /眼睛?-鄙视/,
  /芭比眼/,
  /錢錢眼/,
  /黑臉/,
  /心心眼/,
  /抽菸/,
  /严肃眼/,
  /下三角嘴/,
  /輕蔑/,
  /悠[閑闲]/,
  /水汪汪/,
  /嫌棄/,
  /鄙視/,
  /流口水/,
  /壞笑/,
  /疑惑/,
  /祈求/,
  /嘲諷/,
  /尷尬/,
]

/**
 * Classifies an individual blendshape or morph string into a taxonomy category.
 */
export function classifyExpression(rawName: string): ExpressionCategory {
  const trimmed = rawName.trim()
  if (!trimmed)
    return 'unclassified'

  // UI Category Separators (e.g. ------BROW------)
  if (/^[-=]{2}.*[-=]{2}$/.test(trimmed)) {
    return 'neutral'
  }

  // Chinese Hyphenated Tracking primitives (e.g. 嘴-上, 嘴-下, 眼球-缩小)
  if (/^嘴-([上下大小]|皮肤牙|下弯闭眼).*$/.test(trimmed) || /^眼(球)?-(缩小|放大|集中|分散|看向镜头|下弯闭眼).*$/.test(trimmed)) {
    return 'procedural_eye'
  }

  // Japanese / Chinese Facial & Eyelash Tracking primitives (broad substring gate)
  if (/まつ毛|ハイライト|まぶた|目尻|目頭|瞳孔|瞳_[上下左右]|口[上下左右]|下角度|上歯を隠す|下顎歯|口横|口角|口线|眼角|内[左右]|外牙/.test(trimmed)) {
    return 'procedural_eye'
  }

  // MMD mmd_tools / PMX raw UTF-16 little endian mojibake noise
  if (/[\u4E00-\u9FA5]/.test(trimmed)) {
    if (/[攀洀琀漀氀戀砀猀椀渀凿崀愀爰牎絀缆耀萀蕯蘬蚄蚣蚰贅达鈾难鞾頀]/.test(trimmed)) {
      return 'neutral'
    }
  }

  // Clean leading symbols, numeric prefixes, Maya blendshape prefixes, and VRM_ prefix
  const stripped = trimmed
    .replace(/^[_+#.~]+/, '')
    .replace(/^-\d+-\s*(\d*other\s*)?/i, '')
    .replace(/^\d+\.\s*/, '')
    .replace(/^blendshape\d+\./i, '')
    .replace(/^vrm_/i, '')
    .trim()

  // VRoid Studio root mesh naming convention: Face.M_F00_..._Fcl_...
  // All internal fcl_* morphs are raw sub-mesh shape keys, not top-level VRM expressions.
  if (/fcl_/i.test(stripped)) {
    const fclPart = stripped.substring(stripped.search(/fcl_/i)).toLowerCase()
    if (/^fcl_.*_neutral/i.test(fclPart) || fclPart === 'fcl_mth_neutral')
      return 'neutral'
    if (/^fcl_mth_[aiueo]$/i.test(fclPart))
      return 'viseme'
    return 'procedural_eye'
  }

  // Japanese Game Engine [M_Face] tags (e.g. Mouth_23_0(TalkA_A_S)[M_Face])
  if (/\[m_face\]/i.test(stripped)) {
    if (/\(talk\w*\)/i.test(stripped)) {
      return 'viseme'
    }
    if (/\(normal\)/i.test(stripped)) {
      return 'neutral'
    }
    if (/\(cheek\w*\)/i.test(stripped)) {
      return 'procedural_eye'
    }
    for (const pattern of EMOTE_PATTERNS) {
      if (pattern.test(stripped))
        return 'emote'
    }
    return 'procedural_eye'
  }

  // Japanese single-character kana visemes with digits or tildes (e.g. あ3, い~, え４, いい3)
  if (/^([あいうえおワわんむへ]|ああ|いい|うう|ええ|おお)[\d~〜０-９]*$/.test(stripped)) {
    return 'viseme'
  }

  const normalized = stripped.toLowerCase()
  const cleanName = normalized
    .replace(/^blendshape_|^vrc\.v_|^vrc_v_|^viseme_|^exp_/i, '')
    .replace(/\.exp3\.json$/i, '')
    .trim()

  // 1. Exact procedural set lookup (fast gate)
  if (PROCEDURAL_EYE_SET.has(cleanName) || PROCEDURAL_EYE_SET.has(normalized)) {
    return 'procedural_eye'
  }

  // 2. Raw Numeric / Generic Clip Index Noise
  if (/^\d+$/.test(cleanName) || /^(blendshapeclip#\d+|newclip_\d+|face_ex\d*|faceex\d*|take\d+|clip\d+|ex\d+|part\d+|sp_special\d*|\w+_face_ex\d*|\w+_faceex\d*|\w+-face\d*)$/i.test(normalized)) {
    return 'neutral'
  }

  // 3. VRoid / System Neutral Morphs
  if (/^(fcl_.*_neutral|all_small|all_big)$/i.test(normalized) || cleanName === 'neutral' || cleanName === 'mth_neutral' || cleanName === 'mth_default' || cleanName === 'm_neutral' || /^基本セット\d*$/.test(cleanName) || NEUTRAL_SET.has(cleanName)) {
    return 'neutral'
  }

  // 4. VRoid & Custom Viseme Morphs
  if (/^fcl_mth_[aiueo]$/i.test(normalized) || /^([aiueo]|[a-z0-9]+-[aiueo]|v_[aiueo]|ah|[fm]|mth_[aiueom]|mth_mu)[-_]?(big|small|\d*)$/i.test(cleanName) || VISEME_SET.has(cleanName) || VISEME_SET.has(normalized)) {
    return 'viseme'
  }

  // 4.5 VRoid & Sub-Mesh Internal Component Morphs (Fcl_ALL_*, Fcl_BRW_*, Fcl_EYE_*, Fcl_MTH_*, Fcl_HA_*)
  if (/^fcl_(all|brw|eye|mth|ha)[-_]/i.test(normalized) || /^fcl_/i.test(normalized) || /^cf_[mj]_[a-z0-9]+/i.test(normalized)) {
    return 'procedural_eye'
  }

  // 5. Extended Rig Bone Transform Morphs (EX_move, EX_rotate, EX_stretch, etc.)
  if (/^ex_.*(move|rotate|stretch|forward|front|push|up|down|eye|upper|increase|small|\d+)/i.test(normalized) || /^exstretch/i.test(normalized)) {
    return 'procedural_eye'
  }

  // 6. Compound ARKit / Tracking Primitives (e.g. _eyeSquint+LowerUp_L, _mouthPress+DuckMouth)
  if (cleanName.includes('+')) {
    const parts = cleanName.split('+').map(p => p.trim())
    const allNoise = parts.every((p) => {
      const pNorm = p.replace(/^[_#.~-]+/, '').toLowerCase()
      return ARKIT_SET.has(pNorm) || PROCEDURAL_EYE_SET.has(pNorm) || /^(eye|brow|mouth|mouse|jaw|cheek|nose|iris|teeth|duck)/i.test(pNorm)
    })
    if (allNoise) {
      return 'procedural_eye'
    }
  }

  // 7. ARKit 52 Exact Match (clean or raw)
  if (ARKIT_SET.has(cleanName) || ARKIT_SET.has(normalized)) {
    return 'arkit'
  }

  // Common ARKit snake_case / prefix variations
  if (/^(eye|brow|mouth|mouse|mosue|jaw|cheek|nose)[-_](blink|look|squint|wide|down|up|in|out|dimple|frown|funnel|press|pucker|roll|shrug|smile|stretch|sneer|puff|forward|left|right|open|close)([-_](left|right|l|r|up|down|in|out|\d+))?$/i.test(cleanName)) {
    return 'arkit'
  }

  // 8. Anatomical Tracking / Iris / Pupil / LookAt / Eye Movements
  if (/^(eye|eyes)?(iris|pupil|eyeball|lookat|lookatview|irismove|irismoveback|squint|wide|stretch|press|pucker|roll|shrug|sneer|funnel|dimple|close|crossed|wall|circle|back)/i.test(cleanName)) {
    return 'procedural_eye'
  }
  if (/^([a-z0-9]+-)?(eye|eyes|eyebrow|brow|cheek|cheak|chin|lid|corner|pixel|瞳孔|hitomi|eyelid|lower_eyelid|upper_eyelid|まつ毛|顎|目尻|目頭|瞳|まぶた|highlight)[-_]?(up|down|raise|lower|stretch|curve|left|right|in|out|back|big|circle|long|under|less|ex|pull|push|upper|center|nallow|narrow|half|edge|small|open|close|puff|smooth|[大小左右]|放大|缩小|上げ|下げ|消し|無し|\.[lr]|\d+)*/i.test(cleanName)) {
    return 'procedural_eye'
  }
  if (/^(lower|upper)_lid_(up|down)|(left|right)?_?corner_(up|down)|mouth_corners_(up|down)|squish|crush|showtooth/i.test(cleanName)) {
    return 'procedural_eye'
  }
  if (/^eye(ex|ex-down|ex-less|ex-)/i.test(cleanName) || /^camera/i.test(cleanName)) {
    return 'procedural_eye'
  }

  // 9. Jaw & Teeth Tracking Primitives
  if (/^([a-z0-9]+-)?jaw[-_\s]*(left|right|open|close|forward|up|down)$/i.test(cleanName)) {
    return 'procedural_eye'
  }
  if (/^([a-z0-9]+-)?(under|upper)?teeth[-_\s]*(down|up|pull|push|less|sharp|i|sharp\d*|short|short_up|short_low|long_up|long_low|\d+)?$/i.test(cleanName) || /^([a-z0-9]+-)?i[-_]?teeth\d*$/i.test(cleanName) || /^teethex/i.test(cleanName)) {
    return 'procedural_eye'
  }

  // 10. Mouth & "Mouse" (Japanese typo for mouth) Tracking Primitives
  if (/^([a-z0-9]+-)?(under)?(mouth|mouse|mosue|mth|m)[-_\s]*(up|down|left|right|open|open\d*|close|narrow|wide|stretch|press|pucker|roll|shrug|dimple|funnel|wa\d*|slaver|inner|under-push|under_push|benddown|bendup|ape_shape|center_real|close_v|corners_depth|depth|lower_inside|lower_overlay|lower_overturn|upper_inside|upper_overturn|lower_downleft|lower_downright|lower_left|lower_right|upper_left|upper_right|upper_upleft|upper_upright|←→|→←|[v^▲△▼▽Λ∧ロω]|ω\d*|ω□|big|large|small|\d+)$/i.test(cleanName)) {
    if (/(wa|slaver|[v^▲△▼▽Λ∧ロω])/i.test(cleanName)) {
      return 'emote'
    }
    return 'procedural_eye'
  }
  if (/^mouse_inner_.*/i.test(cleanName) || /^([a-z0-9]+-)?mouse[-_]?(down|up)\d*$/i.test(cleanName) || /^ha_(left|right|mouth)$/i.test(cleanName)) {
    return 'procedural_eye'
  }

  // 11. Visemes / Phonemes
  if (VISEME_SET.has(cleanName) || VISEME_SET.has(normalized) || /^viseme_/i.test(normalized) || /^vrc[._]v[._]/i.test(normalized)) {
    return 'viseme'
  }
  if (/^mouth_[aiueo]$/i.test(cleanName) || /^v_[a-z]+$/i.test(cleanName)) {
    return 'viseme'
  }

  // 12. Procedural Eye / Brow / Blink
  if (PROCEDURAL_EYE_SET.has(cleanName) || PROCEDURAL_EYE_SET.has(normalized)) {
    return 'procedural_eye'
  }
  if (/^(eye_)?blink(_[lr]|\d+)?$/i.test(cleanName) || /^(eye_)?look(up|down|left|right)$/i.test(cleanName)) {
    return 'procedural_eye'
  }
  if (/^eyes?\s+blink\d*$/i.test(cleanName) || /^brow.*curve$/i.test(cleanName)) {
    return 'procedural_eye'
  }

  // 13. Wardrobe / Mesh / Prop toggles
  for (const pattern of WARDROBE_PATTERNS) {
    if (pattern.test(trimmed) || pattern.test(stripped)) {
      return 'wardrobe'
    }
  }

  // 14. Positive Emote Match
  for (const pattern of EMOTE_PATTERNS) {
    if (pattern.test(trimmed) || pattern.test(stripped)) {
      return 'emote'
    }
  }

  return 'unclassified'
}

/**
 * Returns true if the expression category is classified as low-level procedural rig/tracking noise.
 */
export function isTrackingNoise(category: ExpressionCategory): boolean {
  return category === 'arkit' || category === 'viseme' || category === 'procedural_eye' || category === 'neutral'
}

export interface CandidateExpressionsResult {
  /** High-signal emotes + unclassified leakage passed to the LLM curation pass */
  candidates: string[]
  /** Low-level ARKit, visemes, procedural gaze/blinks, and neutral noise */
  filteredNoise: string[]
  /** Wardrobe, clothing, hair, and prop mesh toggles */
  wardrobe: string[]
  /** Total raw count */
  rawCount: number
}

/**
 * Categorizes a collection of raw model blendshape names into candidates (emotes + unclassified),
 * filtered tracking noise, and wardrobe mesh toggles.
 */
export function filterCandidateExpressions(rawNames: string[]): CandidateExpressionsResult {
  const candidates: string[] = []
  const filteredNoise: string[] = []
  const wardrobe: string[] = []

  for (const name of rawNames) {
    const cat = classifyExpression(name)
    if (cat === 'emote' || cat === 'unclassified') {
      candidates.push(name)
    }
    else if (cat === 'wardrobe') {
      wardrobe.push(name)
    }
    else {
      filteredNoise.push(name)
    }
  }

  return {
    candidates,
    filteredNoise,
    wardrobe,
    rawCount: rawNames.length,
  }
}
