/**
 * pool-lock.js
 * 여러 프로세스(grow-pool.js, datascope-verify.js 등)가 같은 data/*.json 풀 파일을
 * 동시에 읽고 쓸 때 덮어쓰기 사고(lost update)를 막기 위한 최소한의 파일 락 + 병합저장 유틸.
 *
 * 규칙: 각 프로세스는 절대 "시작할 때 읽은 낡은 전체 스냅샷"을 그대로 다시 써서는 안 되고,
 * 반드시 withFreshPool()로 락을 잡은 뒤 "지금 디스크에 있는 최신 내용"을 다시 읽어
 * 자신이 이번에 변경한 부분만 병합해서 저장해야 한다.
 */
const fs = require('fs');

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function acquireLock(lockPath, { timeoutMs = 60000, staleMs = 20000 } = {}) {
  const start = Date.now();
  for (;;) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > staleMs) { try { fs.unlinkSync(lockPath); } catch { /* 다른 프로세스가 먼저 지웠을 수 있음 */ } continue; }
      } catch { /* 락 파일이 그 사이 사라졌으면 다음 반복에서 재시도 */ }
      if (Date.now() - start > timeoutMs) throw new Error(`pool lock 획득 실패(${timeoutMs}ms 초과): ${lockPath}`);
      await sleep(120 + Math.random() * 180);
    }
  }
}

function releaseLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch { /* 이미 없으면 무시 */ }
}

/**
 * poolPath를 락으로 보호하며 "최신 디스크 상태"를 읽어 mutateFn(fresh)로 변경한 뒤 저장한다.
 * mutateFn은 fresh 객체(전체 pool)를 in-place로 수정하면 된다.
 *
 * 저장은 임시 파일에 다 쓴 뒤 rename()으로 교체한다 — fs.writeFileSync로 원본 경로에 바로 쓰면
 * grow-pool.js 시작 시의 초기 로드처럼 락을 거치지 않는 다른 프로세스의 읽기가 쓰는 도중의
 * "반쯤 쓰인 파일"을 그대로 읽어 JSON 파싱 오류(Unterminated string 등)를 낼 수 있다.
 * rename은 같은 파일시스템 안에서 원자적이라 리더는 항상 "완전한 이전 파일" 또는
 * "완전한 새 파일" 중 하나만 보게 된다.
 */
async function withFreshPool(poolPath, mutateFn) {
  const lockPath = poolPath + '.lock';
  await acquireLock(lockPath);
  try {
    const fresh = fs.existsSync(poolPath) ? JSON.parse(fs.readFileSync(poolPath, 'utf8')) : {};
    const result = await mutateFn(fresh);
    fresh.updatedAt = Date.now();
    const tmpPath = poolPath + '.tmp-' + process.pid;
    fs.writeFileSync(tmpPath, JSON.stringify(fresh));
    fs.renameSync(tmpPath, poolPath);
    return result;
  } finally {
    releaseLock(lockPath);
  }
}

module.exports = { acquireLock, releaseLock, withFreshPool };
