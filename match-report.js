/**
 * match-report.js
 * 크리에이터 매칭 카드(설계문서 v0.3 — "크리에이터 관점의 결과 표현").
 * 크리에이터가 자기 채널(핸들/URL/채널명)과 광고 ID를 넣으면:
 *   매칭 점수 + 전체 후보군 대비 백분위/등급(S/A/B/C) + 근거(일치 키워드/형식/레퍼런스/품질) + 개선 힌트
 * 를 콘솔 요약 + HTML 카드(매칭리포트/*.html)로 출력한다.
 *
 * 점수는 실시간 계산, 백분위는 광고 등록 시 저장된 분포(data/ad-scores/{adId}.json)를 읽어 계산.
 * pool.json은 읽기 전용. publish.sh 비연결.
 *
 * 사용법:
 *   node match-report.js <adId> <채널핸들|채널URL|채널명>
 *   예) node match-report.js ad-20260709-vzxn @heebab
 */
const fs = require('fs');
const path = require('path');
const { prepareAd, scoreCreator, parseReference, tokenMatches, PLATFORM_SOURCES } = require('./matching-engine');
const { loadAds, loadAdScores, percentileOf } = require('./ad-store');

const DIR = __dirname;
const REPORT_DIR = path.join(DIR, '매칭리포트');

/** 채널 입력(핸들/URL/이름)을 풀에서 찾아 {creator, platform} 반환 */
function resolveCreator(input, pools) {
  const parsed = parseReference(input);
  if (!parsed) return null;
  for (const { platform, src, items } of pools) {
    for (const c of items) {
      if (
        (parsed.type === 'channelId' && c[src.idField] === parsed.value) ||
        (parsed.type === 'handle' && String(c.handle || '').toLowerCase() === parsed.value) ||
        (parsed.type === 'name' && String(c[src.nameField] || '').toLowerCase() === parsed.value) ||
        (parsed.type === 'videoId' && (c.topVideos || []).some((v) => v.videoId === parsed.value))
      ) return { creator: c, platform };
    }
  }
  return null;
}

/** 개선 힌트 생성 — 어떤 이유로 감점됐고 뭘 하면 점수가 오르는지(설명가능성) */
function buildHints(ad, result, prepared) {
  const hints = [];
  const b = result.breakdown;

  // 핵심 키워드(분모) 미매칭이 점수에 직결 — 우선 안내. 맥락 토큰은 보너스라 참고로만
  const missedCore = prepared.adKeywords.core.filter((kw) => !b.matchedKeywords.includes(kw));
  if (missedCore.length) hints.push(`핵심 키워드 중 [${missedCore.slice(0, 8).join(', ')}]이(가) 채널 콘텐츠(제목/태그/설명)에서 발견되지 않았습니다 — 이 키워드가 점수 분모의 90%를 차지합니다.`);

  if (ad.videoFormat && b.formatScore < 100) {
    hints.push(`이 광고는 '${ad.videoFormat}' 형식을 원합니다 — 최근 영상에서 해당 형식이 감지되지 않아 감점됐습니다.` +
      (b.creatorFormatTags.length ? ` (현재 감지된 형식: ${b.creatorFormatTags.join(', ')})` : ''));
  }

  if (b.referenceScore != null && b.referenceScore < 50 && prepared.refs.resolved.length) {
    hints.push(`레퍼런스 채널(${prepared.refs.resolved.map((r) => r.name).join(', ')})과의 유사도가 낮습니다(${b.referenceScore}점).`);
  }

  if (!b.derived.contactEmail) hints.push('채널 설명에 비즈니스 문의 이메일이 없습니다 — 추가하면 CIV 브랜드 안정성(설명란 전문성) 점수와 광고주 연락 가능성이 올라갑니다.');
  if (!b.derived.sponsoredExperience) hints.push('협찬/유료광고 이력이 감지되지 않았습니다 — 이력이 있으면 광고주 신뢰 배지가 표시됩니다.');

  // CIV 기반 힌트: 미산출 사유 또는 50점 미만 약점 영역
  const AREA_LABELS = { reach: '채널 규모·도달력', engagement: '참여도·충성도', growth: '성장 가능성', content: '콘텐츠 안정성', brand: '브랜드 안정성' };
  if (b.civ && !b.civ.available) {
    hints.push('CIV 미산출 — 최소 기준(구독자 3,000+ / 영상 5+ / 운영 30일+) 미달로 CIV 보너스가 ×0.90입니다. 기준 충족 시 최대 ×1.15까지 올라 매칭점수가 함께 오릅니다.');
  } else if (b.civ?.areas) {
    for (const [area, sc] of Object.entries(b.civ.areas)) {
      if (sc < 50) hints.push(`CIV 약점: ${AREA_LABELS[area]} ${sc}점 — 이 영역을 개선하면 CIV 보너스가 올라 매칭점수도 함께 오릅니다.`);
    }
  }
  return hints;
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function bar(label, score, weightLabel) {
  const pct = Math.max(0, Math.min(100, score ?? 0));
  return `<div class="axis"><div class="axis-head"><span>${esc(label)}</span><span>${score != null ? score + '점' : '해당 없음'}${weightLabel ? ` · 가중치 ${weightLabel}` : ''}</span></div>
  <div class="track"><div class="fill" style="width:${pct}%"></div></div></div>`;
}

const GRADE_COLORS = { S: '#7c3aed', A: '#2563eb', B: '#059669', C: '#6b7280' };

function renderHtml({ ad, result, pctInfo, hints, prepared, record }) {
  const b = result.breakdown;
  const gc = (b.civ && b.civ.available && GRADE_COLORS[b.civ.grade]) || '#6b7280';
  const w = prepared.weights;
  const badges = [];
  if (b.derived.sponsoredExperience) badges.push('협찬경험 있음');
  if (b.derived.contactEmail) badges.push('연락 가능');
  for (const r of b.qualityReasons) if (r.startsWith('강점:') || r.startsWith('약점:')) badges.push(r);

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>매칭 카드 — ${esc(result.name)} × ${esc(ad.adName)}</title>
<style>
  body{font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;background:#f3f4f6;margin:0;padding:24px;color:#111827}
  .card{max-width:640px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 4px 16px rgba(0,0,0,.08);overflow:hidden}
  .head{background:${gc};color:#fff;padding:24px}
  .head .ad{opacity:.85;font-size:14px;margin-bottom:6px}
  .head h1{margin:0;font-size:22px}
  .scorebox{display:flex;align-items:baseline;gap:14px;margin-top:14px}
  .score{font-size:44px;font-weight:800}
  .grade{font-size:26px;font-weight:800;background:rgba(255,255,255,.25);border-radius:10px;padding:2px 12px}
  .pct{font-size:15px;opacity:.95}
  .sec{padding:18px 24px;border-top:1px solid #f0f0f2}
  .sec h2{font-size:14px;color:#6b7280;margin:0 0 10px;text-transform:none}
  .axis{margin-bottom:10px}
  .axis-head{display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;color:#374151}
  .track{height:8px;background:#e5e7eb;border-radius:4px}
  .fill{height:100%;border-radius:4px;background:${gc}}
  .chips{display:flex;flex-wrap:wrap;gap:6px}
  .chip{background:#eef2ff;color:#3730a3;border-radius:999px;padding:3px 10px;font-size:12px}
  .chip.badge{background:#ecfdf5;color:#065f46}
  ul{margin:0;padding-left:18px;font-size:13px;color:#374151}
  li{margin-bottom:6px}
  .meta{font-size:12px;color:#9ca3af;padding:14px 24px}
</style></head><body>
<div class="card">
  <div class="head">
    <div class="ad">광고: ${esc(ad.adName)}${ad.videoFormat ? ` · 희망 형식: ${esc(ad.videoFormat)}` : ''}</div>
    <h1>${esc(result.name)} <span style="font-size:14px;opacity:.85">${esc(result.category)} · ${esc(result.tier)} · ${result.metric != null ? result.metric.toLocaleString() : '-'}명</span></h1>
    <div class="scorebox"><span class="score">${result.score}</span><span class="grade">${b.civ && b.civ.available ? `CIV ${b.civ.grade}` : 'CIV 준비중'}</span><span class="pct">매칭점수 = 적합도 ${b.fitScore} × CIV ${b.civ ? b.civ.factor : 1} · 후보 ${record.candidateCount.toLocaleString()}명 중 <b>상위 ${pctInfo.topPct}%</b></span></div>
  </div>
  <div class="sec"><h2>매칭 축별 점수 (적합도)</h2>
    ${bar('키워드 매칭', b.keywordScore, Math.round(w.keyword * 100) + '%')}
    ${bar('영상형식 적합도', b.formatScore, Math.round(w.format * 100) + '%')}
    ${w.reference ? bar('레퍼런스 유사도', b.referenceScore, Math.round(w.reference * 100) + '%') : ''}
  </div>
  <div class="sec"><h2>채널 가치 (YOUCHI CIV 광고용) — 적합도에 보너스 계수로 반영</h2>
    ${b.civ && b.civ.available ? `
    <div style="font-size:15px;font-weight:800;margin-bottom:10px">${b.civ.score}점 <span style="font-size:12px;background:${GRADE_COLORS[b.civ.grade] || '#6b7280'};color:#fff;border-radius:6px;padding:2px 8px">${b.civ.grade}</span>
      <span style="font-size:11px;color:#9ca3af;font-weight:400"> 신뢰도 C=${b.civ.confidence}</span></div>
    ${bar('채널 규모·도달력', b.civ.areas.reach)}
    ${bar('참여도·충성도', b.civ.areas.engagement)}
    ${bar('성장 가능성', b.civ.areas.growth)}
    ${bar('콘텐츠 안정성', b.civ.areas.content)}
    ${bar('브랜드 안정성', b.civ.areas.brand)}
    ` : '<div style="font-size:13px;color:#9ca3af">CIV 분석 준비 중 — 최소 기준(구독자 3,000+/영상 5+/운영 30일+) 미달로 랭킹 후순위 계층에 배치됩니다</div>'}
  </div>
  <div class="sec"><h2>일치한 키워드 (${b.matchedKeywords.length}개)</h2>
    <div class="chips">${b.matchedKeywords.map((k) => `<span class="chip">${esc(k)}</span>`).join('') || '<span style="font-size:13px;color:#9ca3af">일치 키워드 없음</span>'}</div>
  </div>
  ${b.referenceReasons.length ? `<div class="sec"><h2>레퍼런스 비교 근거</h2><ul>${b.referenceReasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''}
  <div class="sec"><h2>품질 배지</h2>
    <div class="chips">${badges.map((x) => `<span class="chip badge">${esc(x)}</span>`).join('') || '<span style="font-size:13px;color:#9ca3af">해당 없음</span>'}</div>
  </div>
  ${hints.length ? `<div class="sec"><h2>개선 힌트</h2><ul>${hints.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></div>` : ''}
  <div class="meta">분포 기준: ${esc(record.scoredAt)} 스코어링 · 매칭엔진 v0.6 (적합도 주도 + CIV 보너스) · 이 카드는 실제 업로드된 영상 데이터로만 계산됩니다</div>
</div>
</body></html>`;
}

function run(adId, channelInput) {
  const { ads } = loadAds();
  const ad = ads.find((a) => a.adId === adId);
  if (!ad) { console.error(`광고 ${adId}를 찾을 수 없음 — node ad-store.js list 로 확인`); process.exit(1); }
  const record = loadAdScores(adId);
  if (!record) { console.error(`광고 ${adId}의 스코어 분포가 없음 — node ad-store.js rescore ${adId} 먼저 실행`); process.exit(1); }

  const prepared = prepareAd(ad);
  const found = resolveCreator(channelInput, prepared.pools);
  if (!found) { console.error(`채널 "${channelInput}"을(를) 풀에서 찾지 못함(핸들/URL/정확한 채널명으로 시도)`); process.exit(1); }

  const result = scoreCreator(found.creator, prepared, found.platform);
  const pctInfo = percentileOf(result.score, record);
  const hints = buildHints(ad, result, prepared);

  console.log(`\n[매칭 카드] ${result.name} × "${ad.adName}"`);
  console.log(`  매칭점수 ${result.score} (적합도 ${result.fitScore} × CIV ${result.breakdown.civ?.factor ?? 1}) | CIV ${result.breakdown.civ?.available ? `${result.breakdown.civ.grade}(${result.breakdown.civ.policy})` : '분석 준비 중'} | 후보 ${record.candidateCount.toLocaleString()}명 중 상위 ${pctInfo.topPct}%`);
  const civ = result.breakdown.civ;
  console.log(`  키워드 ${result.breakdown.keywordScore} / 형식 ${result.breakdown.formatScore} / 레퍼런스 ${result.breakdown.referenceScore ?? '-'} / CIV ${civ?.available ? `${civ.score}점(${civ.grade})` : '준비중'}`);
  console.log(`  일치 키워드: ${result.breakdown.matchedKeywords.join(', ') || '없음'}`);
  for (const h of hints) console.log(`  힌트: ${h}`);

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const safeName = String(result.name).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
  const outPath = path.join(REPORT_DIR, `매칭카드_${adId}_${safeName}.html`);
  fs.writeFileSync(outPath, renderHtml({ ad, result, pctInfo, hints, prepared, record }));
  console.log(`\n  HTML 카드 저장: ${outPath}`);
  return outPath;
}

module.exports = { run, resolveCreator, buildHints };

if (require.main === module) {
  const [adId, ...rest] = process.argv.slice(2);
  const channelInput = rest.join(' ');
  if (!adId || !channelInput) { console.log('사용법: node match-report.js <adId> <채널핸들|채널URL|채널명>'); process.exit(1); }
  run(adId, channelInput);
}
