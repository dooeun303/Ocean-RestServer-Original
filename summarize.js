const express = require('express');
const router  = express.Router();
const fetch   = require('node-fetch');

// =============================================
// POST /api/summarize
// body: JSON { text: "구술 원문", jobTitle?: "유지보수 작업명" }
// 응답: { success: true, summary: "...", model: "..." }  /  { success: false, error: "..." }
//
// STT 원문을 로컬 LLM(Ollama)으로 유지보수 작업기록 형식으로 정리한다. API 키/과금 없음.
//
// 설계: '작업내용'은 유지보수 레코드에 이미 있으므로 작업자가 말하지 않고 LLM도 추론하지 않는다.
//       jobTitle 이 오면 그 값을 '작업내용'에 그대로 박고, 구술에서는 '조치사항/특이사항'만 뽑는다.
//       → LLM이 작업내용을 지어낼 여지가 없어 환각이 크게 준다.
//       jobTitle 이 없으면(테스트 등) 조치사항/특이사항 2줄만 출력.
//
// Ollama는 설치 시 Windows 백그라운드로 11434에서 자동 실행됨. 모델은 `ollama pull` 로 받아둠.
//   기본: exaone3.5:7.8b (LG, 한국어 특화, RTX 3060 GPU 구동) → 실패 시 exaone3.5:2.4b 로 자동 폴백
//   OLLAMA_MODEL 로 목록 재정의 가능(쉼표 구분, 앞에서부터 시도): OLLAMA_MODEL="exaone3.5:2.4b"
//
// 2026-09-04: RTX 3060 Laptop 6GB + Unity 에디터가 GPU를 같이 쓰면 7.8b가 OOM("unable to
//   allocate CUDA_Host buffer")으로 안 뜬다. 대응:
//   ① 모델 목록을 순서대로 시도(7.8b 실패하면 2.4b) ② num_ctx 2048 로 KV 캐시 버퍼 축소
//   ③ keep_alive 로 한 번 뜬 모델 유지. 그래도 다 실패하면 마지막 에러로 502.
// =============================================
const OLLAMA_URL    = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODELS = (process.env.OLLAMA_MODEL || 'exaone3.5:7.8b,exaone3.5:2.4b')
    .split(',').map(s => s.trim()).filter(Boolean);

const MIN_TEXT_LEN = 10; // 이보다 짧으면 요약 생략(환각 방지)

// OOM/모델 로드 실패처럼 "다른 모델로 재시도할 가치가 있는" 에러인지.
function isRetriable(msg) {
    const m = (msg || '').toLowerCase();
    return m.includes('out-of-memory') || m.includes('out of memory') ||
           m.includes('unable to allocate') || m.includes('failed to allocate') ||
           m.includes('error loading model') || m.includes('cuda') ||
           m.includes('500') || m.includes('502') || m.includes('503');
}

async function askOllama(model, messages) {
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model,
            stream: false,
            keep_alive: '30m',
            options: { temperature: 0.2, num_ctx: 2048, num_predict: 256 },
            messages,
        }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(data));
    const summary = ((data.message && data.message.content) || '').trim();
    if (!summary) throw new Error('빈 응답');
    return summary;
}

function buildMessages(text, jobTitle) {
    const rules =
        '당신은 해수담수화 플랜트 유지보수 기록 담당자입니다. ' +
        '작업자가 구술한 내용만 근거로 정리하세요. 구술에 없는 내용은 절대 지어내지 마세요.\n';

    if (jobTitle) {
        return [
            {
                role: 'system',
                content:
                    rules +
                    `작업내용은 이미 "${jobTitle}" 로 확정되어 있습니다. 이 값을 그대로 쓰고 바꾸지 마세요.\n` +
                    '구술에서 조치사항과 특이사항만 추출하세요.\n' +
                    '아래 형식으로만 답하세요:\n' +
                    `작업내용: ${jobTitle}\n` +
                    '조치사항: (한 줄, 구술에 조치 내용이 없으면 "없음")\n' +
                    '특이사항: (한 줄, 없으면 "없음")',
            },
            { role: 'user', content: `작업자 구술:\n${text}` },
        ];
    }

    return [
        {
            role: 'system',
            content:
                rules +
                '구술에서 조치사항과 특이사항만 추출하세요.\n' +
                '아래 형식으로만 답하세요:\n' +
                '조치사항: (한 줄, 없으면 "없음")\n' +
                '특이사항: (한 줄, 없으면 "없음")',
        },
        { role: 'user', content: `작업자 구술:\n${text}` },
    ];
}

router.post('/', async (req, res) => {
    const text     = ((req.body && req.body.text) || '').trim();
    const jobTitle = ((req.body && req.body.jobTitle) || '').trim();

    if (!text) {
        return res.status(400).json({ success: false, error: 'text가 비어 있습니다.' });
    }
    if (text.length < MIN_TEXT_LEN) {
        return res.status(200).json({
            success: false,
            error: `구술 내용이 너무 짧습니다 (${text.length}자). 조치사항과 특이사항을 말한 뒤 다시 시도하세요.`,
        });
    }

    const messages = buildMessages(text, jobTitle);
    let lastErr = '';

    for (let i = 0; i < OLLAMA_MODELS.length; i++) {
        const model = OLLAMA_MODELS[i];
        try {
            const summary = await askOllama(model, messages);
            console.log(`[SUMMARIZE] 완료(${model}):`, summary.slice(0, 60).replace(/\n/g, ' ') + '...');
            return res.json({ success: true, summary, model });
        } catch (err) {
            lastErr = err.message;
            const more = i < OLLAMA_MODELS.length - 1;
            console.error(`[SUMMARIZE] ${model} 실패${more ? ' → 다음 모델 시도' : ''}:`, err.message);
            if (!more || !isRetriable(err.message)) break; // 재시도 가치 없는 에러면 즉시 중단
        }
    }

    return res.status(502).json({
        success: false,
        error: `Ollama(11434) 요약 실패: ${lastErr}. 시도한 모델: ${OLLAMA_MODELS.join(', ')}. ` +
               `ollama 실행 여부, 모델 pull 여부, GPU 메모리(에디터 종료 후 재시도) 확인.`,
    });
});

module.exports = router;
