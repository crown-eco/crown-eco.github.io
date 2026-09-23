/**
 * ============================================================
 *  エコピタ 共通メールアドレス打ち間違い指摘 v1.0
 * ============================================================
 *
 *  【目的】
 *  お客様メールアドレスの「明らかなドメイン打ち間違い」を
 *  送信前にフォーム上で控えめに指摘する（予防）。
 *  ★ブロックはしない★ — そのまま送信できる。実在する珍しい
 *  ドメインを弾かないため、あくまで「もしかして？」の提案のみ。
 *
 *  【重要：運用ルール / デプロイ】
 *  このファイルの実体は各サイトのデプロイリポジトリに
 *  1つだけ置き、そのサイトの全ページから相対パスで読み込むこと。
 *  （shared-nav.js / shared-auth.js と同じ運用）
 *  各HTMLの </body> 直前に次の1行を追加：
 *  <script src="./shared-email-check.js"></script>
 *
 *  ※ この claude-code リポジトリの github_pages/ にも実体を置いて
 *    あるが、本番反映にはデプロイリポジトリ側への同梱が必要。
 *
 *  【設計（handoff 設計v2 指摘7 委譲方式 準拠）】
 *  - document レベルのイベント委譲（focusout / change）で
 *    e.target.matches('input[type="email"]') を判定。個別 input への
 *    直接アタッチはしない（addCcEmail() 等で後から生成される
 *    type="email" の CC 欄にも自動で効かせるため）。
 *  - MutationObserver は使わない（軽量優先）。
 *  - 判定3段: (1)主要ドメイン辞書完全一致→何もしない
 *    (2)頻出タイポ表で直接補正 (3)ドメイン部の編集距離で辞書最近傍
 *    （ドメイン文字数 6以上は ≤2 / 未満は ≤1）。
 *  - ローカル部（@より前）は判定対象外。ドメイン部のみ。
 */

(function () {
  'use strict';

  // 二重読み込み防止（テンプレ共通化等で2回読まれても多重動作しない）
  if (window.__ecopitaEmailCheckLoaded) return;
  window.__ecopitaEmailCheckLoaded = true;

  function cleanInputEmailValue(value) {
    return String(value == null ? '' : value)
      .replace(/^\s*mailto:/i, '')
      .replace(/[<>"']/g, '')
      .replace(/\s+/g, '')
      .trim();
  }

  function normalizeInputEmail(input) {
    if (!input || input.type !== 'email') return '';
    var cleaned = cleanInputEmailValue(input.value);
    if (input.value !== cleaned) input.value = cleaned;
    return cleaned;
  }

  // ============================================================
  //  (1) 日本主要ドメイン辞書（完全一致したら何もしない）
  //  ※ gmail.co.jp は罠（実在しない誤記）なので入れない。
  // ============================================================
  var KNOWN_DOMAINS = [
    'gmail.com',
    'yahoo.co.jp',
    'yahoo.com',
    'icloud.com',
    'me.com',
    'docomo.ne.jp',
    'ezweb.ne.jp',
    'au.com',
    'softbank.ne.jp',
    'i.softbank.jp',
    'ymobile.ne.jp',
    'mineo.jp',
    'outlook.jp',
    'outlook.com',
    'hotmail.com',
    'hotmail.co.jp',
    'live.jp',
    'nifty.com',
    'biglobe.ne.jp',
    'ocn.ne.jp'
  ];

  // 高速判定用セット
  var KNOWN_SET = {};
  for (var ki = 0; ki < KNOWN_DOMAINS.length; ki++) {
    KNOWN_SET[KNOWN_DOMAINS[ki]] = true;
  }

  // ============================================================
  //  (2) 頻出タイポ表（既知の間違い → 正しいドメインへ直接補正）
  //  キーは小文字のドメイン全体（@より後ろ）。
  // ============================================================
  var TYPO_MAP = {
    // gmail 系
    'gmial.com': 'gmail.com',
    'gamil.com': 'gmail.com',
    'gmai.com': 'gmail.com',
    'gmil.com': 'gmail.com',
    'gmaill.com': 'gmail.com',
    'gmail.con': 'gmail.com',
    'gmail.comm': 'gmail.com',
    'gmail.co': 'gmail.com',
    'gmail.cm': 'gmail.com',
    'gmail.om': 'gmail.com',
    'gmal.com': 'gmail.com',
    'gmail.ne.jp': 'gmail.com',
    // yahoo 系
    'yahooo.co.jp': 'yahoo.co.jp',
    'yaho.co.jp': 'yahoo.co.jp',
    'yhoo.co.jp': 'yahoo.co.jp',
    'yahoo.co.j': 'yahoo.co.jp',
    'yahoo.co.jpp': 'yahoo.co.jp',
    'yahoo.ne.jp': 'yahoo.co.jp',
    'yahoo.com.jp': 'yahoo.co.jp',
    // icloud / me
    'iclould.com': 'icloud.com',
    'icoud.com': 'icloud.com',
    'icloud.con': 'icloud.com',
    // docomo
    'docomo.ne.j': 'docomo.ne.jp',
    'docomo.nejp': 'docomo.ne.jp',
    'docomo.co.jp': 'docomo.ne.jp',
    'docmo.ne.jp': 'docomo.ne.jp',
    'docomo.ne.jpp': 'docomo.ne.jp',
    // ezweb / au
    'ezweb.ne.j': 'ezweb.ne.jp',
    'ezweb.nejp': 'ezweb.ne.jp',
    'ezweb.ne.jp': 'ezweb.ne.jp',
    // softbank
    'softbank.ne.j': 'softbank.ne.jp',
    'softbank.nejp': 'softbank.ne.jp',
    'softbnk.ne.jp': 'softbank.ne.jp',
    'i.softbank.jpp': 'i.softbank.jp',
    // outlook / hotmail
    'outlook.con': 'outlook.com',
    'hotmial.com': 'hotmail.com',
    'hotmail.con': 'hotmail.com'
  };

  // 末尾の汎用 TLD/区切りタイポ（ドメイン全体に一致しなかった場合の保険）
  // key=末尾パターン → value=置換後末尾
  var SUFFIX_FIXES = [
    { from: /\.con$/, to: '.com' },
    { from: /\.comm$/, to: '.com' },
    { from: /\.cmo$/, to: '.com' },
    { from: /\.ocm$/, to: '.com' },
    { from: /\.co\.jpp$/, to: '.co.jp' },
    { from: /\.ne\.jpp$/, to: '.ne.jp' },
    { from: /\.ne\.j$/, to: '.ne.jp' },
    { from: /\.co\.j$/, to: '.co.jp' }
  ];

  // 区切り文字のタイポ（カンマ・全角など）→ ドット
  // 例: ne,jp → ne.jp / docomo．ne.jp（全角）→ docomo.ne.jp
  function normalizeDomainSeparators(domain) {
    return domain
      .replace(/[,，]/g, '.')   // カンマ（半角/全角）→ ドット
      .replace(/[。．]/g, '.')  // 全角ピリオド類 → ドット
      .replace(/\.{2,}/g, '.'); // 連続ドット → 1個
  }

  // ============================================================
  //  (3) レーベンシュタイン編集距離
  // ============================================================
  function levenshtein(a, b) {
    if (a === b) return 0;
    var al = a.length;
    var bl = b.length;
    if (al === 0) return bl;
    if (bl === 0) return al;
    var prev = new Array(bl + 1);
    var cur = new Array(bl + 1);
    var i, j;
    for (j = 0; j <= bl; j++) prev[j] = j;
    for (i = 1; i <= al; i++) {
      cur[0] = i;
      var ca = a.charCodeAt(i - 1);
      for (j = 1; j <= bl; j++) {
        var cost = (ca === b.charCodeAt(j - 1)) ? 0 : 1;
        var del = prev[j] + 1;
        var ins = cur[j - 1] + 1;
        var sub = prev[j - 1] + cost;
        var m = del < ins ? del : ins;
        cur[j] = m < sub ? m : sub;
      }
      // swap
      var tmp = prev;
      prev = cur;
      cur = tmp;
    }
    return prev[bl];
  }

  // 辞書最近傍を探す。しきい値内で最小距離の候補を返す（なければ null）
  function nearestKnownDomain(domain) {
    var best = null;
    var bestDist = Infinity;
    for (var i = 0; i < KNOWN_DOMAINS.length; i++) {
      var cand = KNOWN_DOMAINS[i];
      var d = levenshtein(domain, cand);
      if (d === 0) return null; // 完全一致は対象外（呼び出し側で弾く想定だが二重安全）
      // しきい値: 入力ドメイン文字数 6以上は ≤2、未満は ≤1
      var threshold = domain.length >= 6 ? 2 : 1;
      if (d <= threshold && d < bestDist) {
        bestDist = d;
        best = cand;
      }
    }
    return best;
  }

  // ============================================================
  //  メールアドレス → 修正候補（なければ null）
  //  ローカル部は保持し、ドメイン部のみ判定・置換する。
  // ============================================================
  function suggestCorrection(rawValue) {
    if (!rawValue) return null;
    var value = String(rawValue).trim();
    // 単純な形（local@domain）でなければ何もしない
    var at = value.lastIndexOf('@');
    if (at <= 0 || at === value.length - 1) return null;
    var local = value.slice(0, at);
    var domainRaw = value.slice(at + 1);
    // ドメインに @ や空白が残っていたら判定しない（複雑形）
    if (/[\s@]/.test(domainRaw)) return null;

    var domain = domainRaw.toLowerCase();

    // 区切り文字の正規化（カンマ/全角ドット等）。正規化で変わったら候補。
    var normalized = normalizeDomainSeparators(domain);

    // (1) 主要ドメイン辞書に完全一致 → 何もしない
    //     （正規化前で既に正しいなら即終了）
    if (KNOWN_SET[domain]) return null;

    var candidateDomain = null;

    // (2a) 頻出タイポ表（正規化後の完全一致）
    if (TYPO_MAP[normalized]) {
      candidateDomain = TYPO_MAP[normalized];
    } else if (TYPO_MAP[domain]) {
      candidateDomain = TYPO_MAP[domain];
    }

    // (2b) 末尾 TLD タイポの補正
    if (!candidateDomain) {
      for (var s = 0; s < SUFFIX_FIXES.length; s++) {
        if (SUFFIX_FIXES[s].from.test(normalized)) {
          var fixed = normalized.replace(SUFFIX_FIXES[s].from, SUFFIX_FIXES[s].to);
          // 補正結果が辞書にあるか、補正前と異なれば採用
          if (fixed !== normalized) {
            candidateDomain = fixed;
            break;
          }
        }
      }
    }

    // (2c) 区切り正規化だけで辞書一致になったケース
    if (!candidateDomain && normalized !== domain && KNOWN_SET[normalized]) {
      candidateDomain = normalized;
    }

    // (3) 編集距離で辞書最近傍
    if (!candidateDomain) {
      var near = nearestKnownDomain(normalized);
      if (near) candidateDomain = near;
    }

    if (!candidateDomain) return null;
    // 候補ドメインが入力ドメインと実質同じなら提案しない
    if (candidateDomain === domain) return null;

    // ローカル部 + 候補ドメインで完成形を組み立てる
    return local + '@' + candidateDomain;
  }

  // ============================================================
  //  CSS 注入（一度だけ）。各 HTML の CSS は触らない。
  //  既存 .error-msg（薄赤）とは別の控えめな注意色（薄黄）。
  // ============================================================
  var STYLE_ID = 'ecopita-email-check-style';
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css =
      '.ecopita-email-suggest{' +
        'display:block;' +
        'flex-basis:100%;' +    // flex 行内（CC欄）に入っても自分の行に折り返す
        'width:100%;' +
        'box-sizing:border-box;' +
        'margin-top:5px;' +
        'padding:7px 10px;' +
        'background:#fff8e1;' +
        'border:1px solid #ffe082;' +
        'border-radius:8px;' +
        'color:#8a6d00;' +
        'font-size:.8rem;' +
        'line-height:1.5;' +
        'font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",Meiryo,sans-serif;' +
      '}' +
      '.ecopita-email-suggest .ecopita-email-suggest-cand{' +
        'font-weight:700;' +
        'color:#5d4a00;' +
        'word-break:break-all;' +
      '}' +
      '.ecopita-email-suggest .ecopita-email-suggest-fix{' +
        'display:inline-block;' +
        'margin-left:8px;' +
        'margin-top:2px;' +
        'padding:3px 12px;' +
        'background:#ffb300;' +
        'border:none;' +
        'border-radius:6px;' +
        'color:#fff;' +
        'font-size:.8rem;' +
        'font-weight:700;' +
        'cursor:pointer;' +
        'white-space:nowrap;' +
      '}' +
      '.ecopita-email-suggest .ecopita-email-suggest-fix:active{' +
        'background:#ff8f00;' +
      '}' +
      '@media (prefers-color-scheme: dark){' +
        '.ecopita-email-suggest{background:#3a3320;border-color:#6b5d2a;color:#f0d97a;}' +
        '.ecopita-email-suggest .ecopita-email-suggest-cand{color:#ffe082;}' +
      '}';
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  // ============================================================
  //  警告要素の表示／除去
  //  各 input に紐づく警告要素を1つだけ管理する。
  // ============================================================
  // input ごとの警告要素を WeakMap で対応付け（多重生成防止）
  var suggestMap = new WeakMap();

  function removeSuggest(input) {
    var el = suggestMap.get(input);
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
    suggestMap.delete(input);
  }

  function showSuggest(input, candidate) {
    ensureStyle();

    // 同じ候補を既に表示中なら作り直さない。
    // （「修正する」ボタンをタップした瞬間に input から focusout が発火し、
    //   capture 委譲で再評価 → removeSuggest+再生成が走ると、タップ対象の
    //   ボタンが DOM から消えて 1 タップ目が効かなくなる/ちらつく。
    //   候補が同じなら no-op にしてこれを防ぐ。）
    var existing = suggestMap.get(input);
    if (existing && existing.getAttribute('data-cand') === candidate) return;

    // 候補が変わった or 初表示 → 作り直す
    removeSuggest(input);

    var box = document.createElement('div');
    box.className = 'ecopita-email-suggest';
    box.setAttribute('data-cand', candidate);

    var msgHead = document.createTextNode('もしかして ');
    var cand = document.createElement('span');
    cand.className = 'ecopita-email-suggest-cand';
    cand.textContent = candidate; // XSS 対策：textContent で代入
    var msgTail = document.createTextNode(' ではありませんか？');

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ecopita-email-suggest-fix';
    btn.textContent = '修正する';
    btn.addEventListener('click', function () {
      // input.value を候補に置換し、警告を消す
      input.value = candidate;
      removeSuggest(input);
      // 既存フォームのバリデーション等が input/change を待っている場合に備えて発火
      try {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (e) { /* 古い環境向けの保険：失敗しても致命的でない */ }
      input.focus();
    });

    box.appendChild(msgHead);
    box.appendChild(cand);
    box.appendChild(msgTail);
    box.appendChild(btn);

    // input の直後に差し込む
    if (input.parentNode) {
      if (input.nextSibling) {
        input.parentNode.insertBefore(box, input.nextSibling);
      } else {
        input.parentNode.appendChild(box);
      }
    }
    suggestMap.set(input, box);
  }

  // ============================================================
  //  入力欄の評価
  // ============================================================
  function evaluate(input) {
    if (!input || input.type !== 'email') return;
    var value = normalizeInputEmail(input);
    var candidate = suggestCorrection(value);
    if (candidate) {
      showSuggest(input, candidate);
    } else {
      // 候補が無い（＝正しい or 判定不可）なら既存警告を消す
      removeSuggest(input);
    }
  }

  // ============================================================
  //  document レベルのイベント委譲
  //  focusout（blur 相当・バブリングする）と change を listen。
  //  後から追加される CC 欄（type="email"）にも効く。
  // ============================================================
  function onEvent(e) {
    var t = e.target;
    if (t && t.matches && t.matches('input[type="email"]')) {
      evaluate(t);
    }
  }

  function attach() {
    document.addEventListener('focusout', onEvent, true);
    document.addEventListener('change', onEvent, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }

  // デバッグ／セルフテスト用に内部関数を公開（本番動作には影響なし）
  window.__ecopitaEmailCheck = {
    cleanInputEmailValue: cleanInputEmailValue,
    suggestCorrection: suggestCorrection,
    levenshtein: levenshtein,
    nearestKnownDomain: nearestKnownDomain
  };

})();
