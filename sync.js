const https = require("https");

/*
====================================================
 🗂️ FC온라인 FCELO 친선경기(내전) 자동 동기화
 matchtype = 40

 기능
 1. 등록된 모든 스트리머의 최근 경기 조회 (조회 경기수 설정 가능)
 2. matchtype=40 친선경기만 조회
 3. 등록된 스트리머끼리의 경기만 처리
 4. match_history 중복 저장 방지
 5. 새로 등록된 스트리머는 가입일(created_at) 이후 경기만 수집
 6. Nexon API 429 / 서버 오류 자동 재시도
 7. Supabase 오류 로그 및 sync_logs 자동 기록
====================================================
*/


/* ====================================================
    환경변수 및 설정값
==================================================== */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ovqwjdsgatympgknbzje.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_0r6O2ZkKABHU0r0iKOwgXQ_xdDi0R4f";
const NEXON_API_KEY = process.env.NEXON_API_KEY || "live_83ff8e802e9becf6a40ce94c3139fb2867fec60df24edf0dbdf7f33739309aebefe8d04e6d233bd35cf2fabdeb93fb0d";

/* 💡 [조회 경기수 변경 설정] 필요할 때 이 숫자만 수정하시면 한 번에 가져오는 경기가 변경됩니다. */
const MATCH_LIMIT = 10;


/* ====================================================
    필수 환경변수 확인
==================================================== */

function checkEnvironment() {
    const missing = [];

    if (!SUPABASE_URL) {
        missing.push("SUPABASE_URL");
    }

    if (!SUPABASE_ANON_KEY) {
        missing.push("SUPABASE_ANON_KEY");
    }

    if (!NEXON_API_KEY) {
        missing.push("NEXON_API_KEY");
    }

    if (missing.length > 0) {
        throw new Error(
            `[설정 오류] 다음 환경변수가 없습니다: ${missing.join(", ")}`
        );
    }
}


/* ====================================================
    대기 함수
==================================================== */

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


/* ====================================================
    URL 안전하게 생성
==================================================== */

function buildUrl(base, params = {}) {
    const url = new URL(base);

    for (const [key, value] of Object.entries(params)) {
        if (
            value !== undefined &&
            value !== null
        ) {
            url.searchParams.set(key, value);
        }
    }

    return url.toString();
}


/* ====================================================
    HTTPS 요청 공통 함수
==================================================== */

function request({
    url,
    method = "GET",
    headers = {},
    body = null
}) {
    return new Promise((resolve) => {

        const urlObj = new URL(url);

        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method,
            headers
        };

        const req = https.request(
            options,
            (res) => {

                let data = "";

                res.on(
                    "data",
                    chunk => {
                        data += chunk;
                    }
                );

                res.on(
                    "end",
                    () => {

                        let parsed = null;

                        try {
                            parsed = data
                                ? JSON.parse(data)
                                : null;
                        } catch (error) {
                            parsed = null;
                        }

                        resolve({
                            status: res.statusCode,
                            headers: res.headers,
                            data: parsed,
                            raw: data
                        });
                    }
                );
            }
        );

        req.on(
            "error",
            error => {

                resolve({
                    status: 0,
                    headers: {},
                    data: null,
                    raw: error.message,
                    error
                });
            }
        );

        if (body !== null) {
            req.write(JSON.stringify(body));
        }

        req.end();
    });
}


/* ====================================================
    Nexon API 요청
==================================================== */

async function fetchNexon(
    url,
    maxRetry = 5
) {

    for (
        let attempt = 0;
        attempt <= maxRetry;
        attempt++
    ) {

        const result = await request({
            url,
            method: "GET",
            headers: {
                "x-nxopen-api-key":
                    NEXON_API_KEY
            }
        });


        /* 성공 */

        if (
            result.status >= 200 &&
            result.status < 300
        ) {
            return result.data;
        }


        /* 오류 로그 */

        console.error(
            `\n[NEXON API ERROR] HTTP ${result.status}`
        );

        console.error(
            `[URL] ${url}`
        );

        console.error(
            `[RESPONSE] ${
                result.raw || "응답 없음"
            }`
        );


        /*
         * 재시도 가능한 오류
         */

        const retryableStatus = [
            0,
            429,
            500,
            502,
            503,
            504
        ];


        if (
            retryableStatus.includes(
                result.status
            ) &&
            attempt < maxRetry
        ) {

            const waitMs =
                1000 *
                Math.pow(
                    2,
                    attempt
                );


            console.log(
                `[NEXON 재시도 ${attempt + 1}/${maxRetry}] ` +
                `${waitMs}ms 대기`
            );


            await sleep(waitMs);

            continue;
        }


        return null;
    }


    return null;
}


/* ====================================================
    Supabase GET
==================================================== */

async function fetchJson(
    url,
    extraHeaders = {}
) {

    const result = await request({
        url,
        method: "GET",
        headers: {
            "apikey":
                SUPABASE_ANON_KEY,

            "Authorization":
                `Bearer ${SUPABASE_ANON_KEY}`,

            ...extraHeaders
        }
    });


    if (
        result.status >= 200 &&
        result.status < 300
    ) {

        return result.data;
    }


    console.error(
        `\n[SUPABASE GET ERROR] HTTP ${result.status}`
    );

    console.error(
        `[URL] ${url}`
    );

    console.error(
        `[RESPONSE] ${
            result.raw || "응답 없음"
        }`
    );


    return null;
}


/* ====================================================
    Supabase POST
==================================================== */

async function postJson(
    url,
    body,
    extraHeaders = {}
) {

    const result = await request({
        url,
        method: "POST",

        headers: {
            "apikey":
                SUPABASE_ANON_KEY,

            "Authorization":
                `Bearer ${SUPABASE_ANON_KEY}`,

            "Content-Type":
                "application/json",

            "Prefer":
                "return=representation",

            ...extraHeaders
        },

        body
    });


    if (
        result.status >= 200 &&
        result.status < 300
    ) {

        return result.data;
    }


    console.error(
        `\n[SUPABASE POST ERROR] HTTP ${result.status}`
    );

    console.error(
        `[URL] ${url}`
    );

    console.error(
        `[BODY] ${JSON.stringify(body)}`
    );

    console.error(
        `[RESPONSE] ${
            result.raw || "응답 없음"
        }`
    );


    return null;
}


/* ====================================================
    Supabase PATCH
==================================================== */

async function patchJson(
    url,
    body,
    extraHeaders = {}
) {

    const result = await request({
        url,
        method: "PATCH",

        headers: {
            "apikey":
                SUPABASE_ANON_KEY,

            "Authorization":
                `Bearer ${SUPABASE_ANON_KEY}`,

            "Content-Type":
                "application/json",

            "Prefer":
                "return=representation",

            ...extraHeaders
        },

        body
    });


    if (
        result.status >= 200 &&
        result.status < 300
    ) {

        return result.data;
    }


    console.error(
        `\n[SUPABASE PATCH ERROR] HTTP ${result.status}`
    );

    console.error(
        `[URL] ${url}`
    );

    console.error(
        `[BODY] ${JSON.stringify(body)}`
    );

    console.error(
        `[RESPONSE] ${
            result.raw || "응답 없음"
        }`
    );


    return null;
}


/* ====================================================
    등록된 스트리머 조회
==================================================== */

async function getStreamers() {

    const url =
        `${SUPABASE_URL}` +
        `/rest/v1/streamers` +
        `?select=*`;


    const streamers =
        await fetchJson(url);


    if (
        !Array.isArray(streamers)
    ) {

        console.error(
            "[오류] 스트리머 목록을 불러오지 못했습니다."
        );

        return [];
    }


    return streamers;
}


/* ====================================================
    match_history 존재 여부
==================================================== */

async function matchExists(
    matchId
) {

    const url =
        `${SUPABASE_URL}` +
        `/rest/v1/match_history` +
        `?match_id=eq.${encodeURIComponent(matchId)}` +
        `&select=match_id`;


    const result =
        await fetchJson(url);


    if (
        result === null
    ) {

        console.error(
            `[경기 확인 실패] ${matchId}`
        );

        return null;
    }


    return (
        Array.isArray(result) &&
        result.length > 0
    );
}


/* ====================================================
    경기 기록 저장
==================================================== */

async function insertMatchHistory({
    matchId,
    streamerA,
    streamerB,
    scoreA,
    scoreB,
    result,
    matchDate
}) {

    const resultString =
        `${streamerA} ` +
        `${scoreA}:${scoreB} ` +
        `${streamerB} ` +
        `(${result})`;


    const url =
        `${SUPABASE_URL}` +
        `/rest/v1/match_history`;


    const saved =
        await postJson(
            url,
            {
                match_id:
                    matchId,

                streamer_a:
                    streamerA,

                streamer_b:
                    streamerB,

                score_a:
                    scoreA,

                score_b:
                    scoreB,

                summary:
                    resultString,

                match_date:
                    matchDate
            }
        );


    if (!saved) {

        console.error(
            `[경기 저장 실패] ${matchId}`
        );

        return false;
    }


    return true;
}


/* ====================================================
    스트리머 ELO / 승무패 업데이트
==================================================== */

async function updateStreamerStats(
    streamerId,
    wins,
    draws,
    losses,
    elo
) {

    const url =
        `${SUPABASE_URL}` +
        `/rest/v1/streamers` +
        `?id=eq.${encodeURIComponent(streamerId)}`;


    const result =
        await patchJson(
            url,
            {
                wins,
                draws,
                losses,
                elo
            }
        );


    return result !== null;
}


/* ====================================================
    H2H 업데이트
==================================================== */

async function updateH2HSummary(
    playerA,
    playerB,
    resultA
) {

    const [
        first,
        second
    ] =
        [playerA, playerB]
            .sort();


    const isFirstPlayerA =
        first === playerA;


    const query =
        `player_first=eq.${encodeURIComponent(first)}` +
        `&player_second=eq.${encodeURIComponent(second)}` +
        `&select=*`;


    const url =
        `${SUPABASE_URL}` +
        `/rest/v1/h2h_summary` +
        `?${query}`;


    const existing =
        await fetchJson(url);


    if (
        existing === null
    ) {

        console.error(
            "[H2H 조회 실패]"
        );

        return false;
    }


    const firstWon =
        (
            isFirstPlayerA &&
            resultA === "승"
        ) ||
        (
            !isFirstPlayerA &&
            resultA === "패"
        );


    const isDraw =
        resultA === "무";


    const firstLost =
        (
            isFirstPlayerA &&
            resultA === "패"
        ) ||
        (
            !isFirstPlayerA &&
            resultA === "승"
        );


    if (
        Array.isArray(existing) &&
        existing.length > 0
    ) {

        const row =
            existing[0];


        const wins =
            (row.wins || 0) +
            (
                firstWon
                    ? 1
                    : 0
            );


        const draws =
            (row.draws || 0) +
            (
                isDraw
                    ? 1
                    : 0
            );


        const losses =
            (row.losses || 0) +
            (
                firstLost
                    ? 1
                    : 0
            );


        const patchUrl =
            `${SUPABASE_URL}` +
            `/rest/v1/h2h_summary` +
            `?id=eq.${encodeURIComponent(row.id)}`;


        const updated =
            await patchJson(
                patchUrl,
                {
                    wins,
                    draws,
                    losses
                }
            );


        return updated !== null;
    }


    const insertUrl =
        `${SUPABASE_URL}` +
        `/rest/v1/h2h_summary`;


    const created =
        await postJson(
            insertUrl,
            {
                player_first:
                    first,

                player_second:
                    second,

                wins:
                    firstWon
                        ? 1
                        : 0,

                draws:
                    isDraw
                        ? 1
                        : 0,

                losses:
                    firstLost
                        ? 1
                        : 0
            }
        );


    return created !== null;
}


/* ====================================================
    한 경기의 ELO / 전적 / H2H / 경기기록 처리
==================================================== */

async function processMatch(
    target,
    opponent,
    resultStr,
    myGoals,
    oppGoals,
    matchId,
    matchDate
) {

    const streamers =
        await getStreamers();


    if (
        !Array.isArray(streamers)
    ) {

        console.error(
            `[처리 실패] 최신 스트리머 데이터 조회 실패`
        );

        return false;
    }


    const targetCurrent =
        streamers.find(
            item =>
                item.id === target.id
        );


    const opponentCurrent =
        streamers.find(
            item =>
                item.id === opponent.id
        );


    if (
        !targetCurrent ||
        !opponentCurrent
    ) {

        console.error(
            `[처리 실패] 스트리머 데이터 없음`
        );

        return false;
    }


    let targetWins =
        Number(
            targetCurrent.wins
        ) || 0;


    let targetDraws =
        Number(
            targetCurrent.draws
        ) || 0;


    let targetLosses =
        Number(
            targetCurrent.losses
        ) || 0;


    let targetElo =
        Number(
            targetCurrent.elo
        ) || 1500;


    let opponentWins =
        Number(
            opponentCurrent.wins
        ) || 0;


    let opponentDraws =
        Number(
            opponentCurrent.draws
        ) || 0;


    let opponentLosses =
        Number(
            opponentCurrent.losses
        ) || 0;


    let opponentElo =
        Number(
            opponentCurrent.elo
        ) || 1500;


    if (
        resultStr === "승"
    ) {

        targetWins++;

        opponentLosses++;

    } else if (
        resultStr === "패"
    ) {

        targetLosses++;

        opponentWins++;

    } else {

        targetDraws++;

        opponentDraws++;
    }


    const actualScore =
        resultStr === "승"
            ? 1
            : resultStr === "무"
                ? 0.5
                : 0;


    const expectedScore =
        1 /
        (
            1 +
            Math.pow(
                10,
                (
                    opponentElo -
                    targetElo
                ) / 400
            )
        );


    const rawDelta =
        (
            32 *
            (
                actualScore -
                expectedScore
            )
        ) +
        (
            (
                myGoals -
                oppGoals
            ) * 3
        );


    const eloDelta =
        Math.round(
            rawDelta
        );


    const newTargetElo =
        Math.max(
            1000,
            targetElo +
            eloDelta
        );


    const newOpponentElo =
        Math.max(
            1000,
            opponentElo -
            eloDelta
        );


    console.log(
        `\n[ELO 처리] ` +
        `${targetCurrent.streamer_name} vs ` +
        `${opponentCurrent.streamer_name}`
    );


    console.log(
        `[스코어] ` +
        `${myGoals}:${oppGoals}`
    );


    console.log(
        `[결과] ${resultStr}`
    );


    console.log(
        `[ELO] ` +
        `${targetElo} → ${newTargetElo} | ` +
        `${opponentElo} → ${newOpponentElo}`
    );


    const targetUpdated =
        await updateStreamerStats(
            targetCurrent.id,
            targetWins,
            targetDraws,
            targetLosses,
            newTargetElo
        );


    if (!targetUpdated) {

        console.error(
            "[처리 실패] 대상 스트리머 업데이트 실패"
        );

        return false;
    }


    const opponentUpdated =
        await updateStreamerStats(
            opponentCurrent.id,
            opponentWins,
            opponentDraws,
            opponentLosses,
            newOpponentElo
        );


    if (!opponentUpdated) {

        console.error(
            "[처리 실패] 상대 스트리머 업데이트 실패"
        );

        return false;
    }


    const h2hUpdated =
        await updateH2HSummary(
            targetCurrent.streamer_name,
            opponentCurrent.streamer_name,
            resultStr
        );


    if (!h2hUpdated) {

        console.error(
            "[처리 실패] H2H 업데이트 실패"
        );

        return false;
    }


    const historySaved =
        await insertMatchHistory({
            matchId,

            streamerA:
                targetCurrent.streamer_name,

            streamerB:
                opponentCurrent.streamer_name,

            scoreA:
                myGoals,

            scoreB:
                oppGoals,

            result:
                resultStr,

            matchDate
        });


    if (!historySaved) {

        console.error(
            "[처리 실패] 경기 기록 저장 실패"
        );

        return false;
    }


    console.log(
        `[저장 성공] ${matchId}`
    );


    return true;
}


/* ====================================================
    친선경기 matchtype=40 동기화
==================================================== */

async function syncMatchHistoryType40(
    streamer,
    allStreamers
) {

    console.log(
        `\n----------------------------------------`
    );


    console.log(
        `[${streamer.streamer_name}] ` +
        `친선경기 조회 시작`
    );


    console.log(
        `OUID: ${streamer.ouid}`
    );


    const streamerCreatedAt = streamer.created_at ? new Date(streamer.created_at).getTime() : 0;
    console.log(`[가입일 필터] ${streamer.streamer_name} 가입일 기준: ${streamer.created_at || '기록 없음 (전체 수집)'}`);


    /*
     * 💡 [조회 경기수 설정 반영] 지정된 MATCH_LIMIT(기본 20경기)만큼 가져옴
     */

    const matchListUrl =
        buildUrl(
            "https://open.api.nexon.com/fconline/v1/user/match",
            {
                ouid:
                    streamer.ouid,

                matchtype:
                    40,

                offset:
                    0,

                limit:
                    MATCH_LIMIT
            }
        );


    const matchIds =
        await fetchNexon(
            matchListUrl
        );


    if (
        !Array.isArray(matchIds)
    ) {

        console.error(
            `[${streamer.streamer_name}] ` +
            `매치 목록 조회 실패`
        );

        return 0;
    }


    console.log(
        `[${streamer.streamer_name}] ` +
        `조회된 친선경기: ${matchIds.length}건 (설정된 한계: ${MATCH_LIMIT}경기)`
    );


    let updatedCount = 0;


    const orderedMatchIds =
        [...matchIds]
            .reverse();


    for (
        const matchId of
        orderedMatchIds
    ) {

        const exists =
            await matchExists(
                matchId
            );


        if (
            exists === null
        ) {

            console.error(
                `[SKIP] 중복 확인 실패: ${matchId}`
            );

            continue;
        }


        if (exists) {
            continue;
        }


        const detailUrl =
            buildUrl(
                "https://open.api.nexon.com/fconline/v1/match-detail",
                {
                    matchid:
                        matchId
                }
            );


        const detail =
            await fetchNexon(
                detailUrl
            );


        if (
            !detail
        ) {

            console.error(
                `[SKIP] 경기 상세 조회 실패`
            );

            continue;
        }


        if (
            !Array.isArray(
                detail.matchInfo
            ) ||
            detail.matchInfo.length < 2
        ) {

            console.error(
                `[SKIP] matchInfo 데이터 부족`
            );

            continue;
        }


        const matchDateStr = detail.matchDate;
        const matchTime = matchDateStr ? new Date(matchDateStr).getTime() : 0;

        if (streamerCreatedAt > 0 && matchTime < streamerCreatedAt) {
            console.log(`[SKIP] 가입일(${streamer.created_at}) 이전의 과거 경기이므로 제외: ${matchId}`);
            continue;
        }


        const p1 =
            detail.matchInfo[0];


        const p2 =
            detail.matchInfo[1];


        if (
            p1.ouid !== streamer.ouid &&
            p2.ouid !== streamer.ouid
        ) {

            console.error(
                `[SKIP] 현재 스트리머가 경기 참가자가 아님`
            );

            continue;
        }


        const myInfo =
            p1.ouid === streamer.ouid
                ? p1
                : p2;


        const opponentInfo =
            p1.ouid === streamer.ouid
                ? p2
                : p1;


        const opponentOuid =
            opponentInfo.ouid;


        const opponent =
            allStreamers.find(
                item =>
                    item.ouid ===
                    opponentOuid
            );


        if (!opponent) {

            console.log(
                `[SKIP] 등록되지 않은 상대와의 경기`
            );

            continue;
        }


        const resultStr =
            myInfo
                ?.matchDetail
                ?.matchResult;


        if (
            !["승", "무", "패"]
                .includes(resultStr)
        ) {

            console.error(
                `[SKIP] 알 수 없는 경기 결과: ${resultStr}`
            );

            continue;
        }


        const myGoals =
            Number(
                myInfo
                    ?.shoot
                    ?.goalTotal
            ) || 0;


        const opponentGoals =
            Number(
                opponentInfo
                    ?.shoot
                    ?.goalTotal
            ) || 0;


        const matchDate =
            detail.matchDate ||
            new Date().toISOString();


        console.log(
            `[내전 발견] ` +
            `${streamer.streamer_name} vs ` +
            `${opponent.streamer_name}`
        );


        await sleep(150);


        const success =
            await processMatch(
                streamer,
                opponent,
                resultStr,
                myGoals,
                opponentGoals,
                matchId,
                matchDate
            );


        if (success) {

            updatedCount++;

        } else {

            console.error(
                `[저장 실패] ` +
                `${matchId}`
            );
        }


        await sleep(150);
    }


    return updatedCount;
}


/* ====================================================
    메인 동기화
==================================================== */

async function runFriendlySync() {

    checkEnvironment();


    console.log(
        "\n========================================"
    );


    console.log(
        " FC온라인 친선경기/내전 동기화 시작"
    );


    console.log(
        ` matchtype = 40 (조회 제한: ${MATCH_LIMIT}경기)`
    );


    console.log(
        ` 실행시간: ${new Date().toISOString()}`
    );


    console.log(
        "========================================\n"
    );


    const streamers =
        await getStreamers();


    if (
        !Array.isArray(streamers) ||
        streamers.length === 0
    ) {

        console.log(
            "등록된 스트리머가 없습니다."
        );

        return;
    }


    console.log(
        `등록된 스트리머: ${streamers.length}명`
    );


    let totalSyncedCount = 0;


    for (
        const streamer of
        streamers
    ) {

        if (
            !streamer.ouid
        ) {

            console.log(
                `[SKIP] ${streamer.streamer_name} ` +
                `OUID 없음`
            );

            continue;
        }


        const count =
            await syncMatchHistoryType40(
                streamer,
                streamers
            );


        totalSyncedCount +=
            count;


        await sleep(300);
    }


    console.log(
        "\n========================================"
    );


    console.log(
        `친선경기 동기화 완료`
    );


    console.log(
        `총 신규 처리 경기: ` +
        `${totalSyncedCount}건`
    );


    console.log(
        "========================================\n"
    );

    /* ====================================================
     * Supabase sync_logs 테이블에 성공 로그 기록
     * ==================================================== */
    try {
        const logUrl = `${SUPABASE_URL}/rest/v1/sync_logs`;
        const logBody = {
            status: "SUCCESS",
            message: `전체 데이터 동기화 작업이 완료되었습니다. (신규 처리: ${totalSyncedCount}건)`
        };
        
        await postJson(logUrl, logBody);
        console.log("[로그 저장 완료] sync_logs 테이블에 반영되었습니다.");
    } catch (logErr) {
        console.error("[로그 저장 실패]", logErr);
    }
}


/* ====================================================
    실행
==================================================== */

runFriendlySync()
    .then(() => {

        console.log(
            "[SYNC 정상 종료]"
        );

    })
    .catch(error => {

        console.error(
            "\n[SYNC 치명적 오류]"
        );

        console.error(
            error
        );

        process.exitCode = 1;
    });
