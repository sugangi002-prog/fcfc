const puppeteer = require('puppeteer');

const SUPABASE_URL = "https://ovqwjdsgatympgknbzje.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_0r6O2ZkKABHU0r0iKOwgXQ_xdDi0R4f";

// 💡 발급받으신 완벽한 웹 앱 URL
const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbx8TFmUbFdE6T5oZS5Gd5okR2QXrA70-h028FY1sOk5KM7MmwOa7kfGHoZhih4of1o/exec";

function getSupabaseHeaders() {
    return {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": "Bearer " + SUPABASE_ANON_KEY,
        "Content-Type": "application/json"
    };
}

async function updateAllSquadValues() {
    console.log("🔄 Supabase에서 스트리머 목록을 불러오는 중...");
    
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/streamers?profile_popup_id=not.is.null&select=streamer_name,profile_popup_id`, {
            headers: getSupabaseHeaders()
        });
        const streamers = await res.json();

        if (!Array.isArray(streamers) || streamers.length === 0) {
            console.log("⚠️ 팝업 고유 번호가 등록된 스트리머가 없습니다.");
            return;
        }

        console.log(`✨ 총 ${streamers.length}명의 스트리머 정보 갱신을 시작합니다.`);

        const browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 900 });

        for (let streamer of streamers) {
            const popupId = streamer.profile_popup_id;
            let updateData = {};

            // 1. 스쿼드 팝업 페이지 접속
            const squadUrl = `https://fconline.nexon.com/profile/squad/popup/${popupId}`;
            console.log(`👉 [${streamer.streamer_name}] 스쿼드 페이지 접속 중...`);

            try {
                await page.goto(squadUrl, { waitUntil: 'networkidle2', timeout: 20000 });
                await page.waitForSelector('.squad__info-panel__price .sum_main strong', { timeout: 10000 });

                // 구단 가치 추출 (기존 셀렉터에서 텍스트를 가져온 뒤 공백 및 불필요한 문자 정리)
                const squadValue = await page.$eval('.squad__info-panel__price .sum_main strong', el => {
                    let text = el.textContent.trim();
                    // 혹시 포함될 수 있는 안내 문구 제거
                    return text.replace(/※.*$/, '').trim();
                });
                updateData.squad_value = squadValue;
                console.log(`    └ 💰 구단 가치: ${squadValue}`);

                // 조작 타입 추출
                const controlType = await page.evaluate(() => {
                    const elements = Array.from(document.querySelectorAll('span, div, p'));
                    const found = elements.find(el => el.textContent.includes('유저') && el.textContent.length < 10);
                    return found ? found.textContent.trim() : "정보 없음";
                });
                updateData.control_type = controlType;
                console.log(`    └ 🎮 조작 타입: ${controlType}`);

                // 💡 [순서 1] 스크린샷 캡처 전, 휠 5번(약 500px)만큼 먼저 스크롤 내리기
                await page.evaluate(() => window.scrollBy(0, 500));
                await new Promise(resolve => setTimeout(resolve, 500));

                // 💡 [순서 2] 스크롤을 내린 상태에서 '카드 배경 숨기기' 체크박스 강제 클릭
                await page.evaluate(() => {
                    const labels = Array.from(document.querySelectorAll('label'));
                    const targetLabel = labels.find(label => label.textContent.includes('카드 배경 숨기기'));
                    
                    if (targetLabel) {
                        targetLabel.click();
                        return;
                    }

                    const allElements = Array.from(document.querySelectorAll('span, div, p'));
                    const targetElement = allElements.find(el => 
                        el.textContent.includes('카드 배경 숨기기') && 
                        el.children.length === 0
                    );
                    
                    if (targetElement) {
                        targetElement.click();
                        if (targetElement.parentElement) {
                            targetElement.parentElement.click();
                        }
                    }
                });

                await new Promise(resolve => setTimeout(resolve, 1500));

                // 💡 [순서 3] 스크롤(500) + 상단 여백(118)을 반영한 완벽한 clip 좌표 캡처
                const screenshotBuffer = await page.screenshot({
                    clip: {
                        x: 0,
                        y: 618,      // 500 (스크롤) + 118 (버릴 상단 높이)
                        width: 1280,
                        height: 782
                    }
                });
                const base64Image = screenshotBuffer.toString('base64');
                const fileName = `${popupId}.png`;

                console.log(`    └ 🚀 구글 드라이브로 이미지 업로드 중...`);
                
                // 구글 서버 과부하 방지 및 재시도(Retry) 로직
                let uploadResult = { status: 'error' };
                let retryCount = 0;
                const maxRetries = 3;

                while (retryCount < maxRetries) {
                    try {
                        const uploadRes = await fetch(GAS_WEB_APP_URL, {
                            method: 'POST',
                            body: JSON.stringify({
                                filename: fileName,
                                mimeType: 'image/png',
                                base64Data: base64Image
                            })
                        });
                        uploadResult = await uploadRes.json();

                        if (uploadResult.status === 'success') {
                            break; 
                        } else {
                            throw new Error(uploadResult.message);
                        }
                    } catch (err) {
                        retryCount++;
                        console.log(`    └ ⚠️ 구글 서버 응답 지연. ${retryCount * 3}초 대기 후 재시도합니다... (${retryCount}/${maxRetries})`);
                        await new Promise(resolve => setTimeout(resolve, 3000 * retryCount));
                    }
                }

                if (uploadResult.status === 'success') {
                    updateData.squad_image_url = uploadResult.url;
                    console.log(`    └ 📸 구글 드라이브 업로드 및 직링크 생성 성공`);
                } else {
                    console.error(`    └ ❌ 구글 드라이브 업로드 최종 실패`);
                }

            } catch (err) {
                console.error(`    └ ❌ 스쿼드 페이지 파싱/캡처 오류:`, err.message);
            }

            // 2. 경기 기록(Stat) 팝업 페이지 접속 (현재 시즌 / 지난 시즌 구분 파싱 적용)
            const statUrl = `https://fconline.nexon.com/profile/stat/popup/${popupId}`;
            console.log(`👉 [${streamer.streamer_name}] 전적 페이지 접속 중...`);

            try {
                await page.goto(statUrl, { waitUntil: 'networkidle2', timeout: 20000 });
                await new Promise(resolve => setTimeout(resolve, 2000));

                const stats = await page.evaluate(() => {
                    const allElements = Array.from(document.querySelectorAll('span, p, div, dd'));
                    const validRecords = allElements
                        .map(el => el.textContent.trim())
                        .filter(text => text.includes('승') && text.includes('패') && text.length < 30);
                    
                    const uniqueRecords = [...new Set(validRecords)];

                    return {
                        current: uniqueRecords[0] || "기록 없음",
                        last: uniqueRecords[1] || uniqueRecords[0] || "기록 없음"
                    };
                });

                // 동일하게 가져와질 경우의 보완 파싱 로직
                if (stats.current === stats.last) {
                    const fallbackStats = await page.evaluate(() => {
                        const boxes = Array.from(document.querySelectorAll('.rank_view, .stadium_info_v2, div[class*="record"]'));
                        if (boxes.length >= 2) {
                            return {
                                current: boxes[0].innerText.replace(/\n/g, ' ').trim(),
                                last: boxes[1].innerText.replace(/\n/g, ' ').trim()
                            };
                        }
                        return null;
                    });
                    if (fallbackStats) {
                        stats.current = fallbackStats.current;
                        stats.last = fallbackStats.last;
                    }
                }

                updateData.current_season_record = stats.current;
                updateData.last_season_record = stats.last;
                console.log(`    └ ⚽ 현재 시즌: ${stats.current}`);
                console.log(`    └ ⚽ 지난 시즌: ${stats.last}`);

            } catch (err) {
                console.error(`    └ ❌ 전적 페이지 파싱 오류:`, err.message);
            }

            // 3. Supabase에 모든 데이터 업데이트
            if (Object.keys(updateData).length > 0) {
                const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/streamers?streamer_name=eq.${encodeURIComponent(streamer.streamer_name)}`, {
                    method: 'PATCH',
                    headers: {
                        ...getSupabaseHeaders(),
                        "Prefer": "return=minimal"
                    },
                    body: JSON.stringify(updateData)
                });

                if (updateRes.ok) {
                    console.log(`    └ 💾 Supabase 종합 정보 반영 완료!`);
                } else {
                    console.error(`    └ ❌ Supabase 반영 실패:`, await updateRes.text());
                }
            }

            // 다음 스트리머로 넘어가기 전 3초간 휴식 (과부하 방지)
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        await browser.close();
        console.log("🎉 모든 스트리머의 종합 정보 갱신 작업이 완료되었습니다!");

    } catch (err) {
        console.error("❌ 전체 프로세스 오류:", err);
    }
}

updateAllSquadValues();
