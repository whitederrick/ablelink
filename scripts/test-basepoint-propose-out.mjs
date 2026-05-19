// scripts/test-basepoint-propose.mjs
// basepoint propose API 테스트 (curl 대체)
// 실행:
//   BASE_URL=http://localhost:3000 node scripts/test-basepoint-propose.mjs
// 또는(Windows PowerShell):
//   $env:BASE_URL="http://localhost:3000"; node scripts/test-basepoint-propose.mjs
//
// siteId/userId 및 좌표값은 반드시 본인 DB에 맞게 수정하세요.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const ENDPOINT = `${BASE_URL}/api/site/basepoint/propose`;

// ✅ 여기만 수정해서 쓰세요.
const TESTS = [
  {
    name: "WITHIN (<=100m) 기대: APPROVED/applied=true",
    body: {
      siteId: "1",
      userId: "10",
      // 주의: 이 값이 'sites.gps_lat/gps_lon'과 100m 이내가 되도록 맞추세요.
      proposedLat: 37.5719,
      proposedLon: 126.9708,
      accuracyM: 12,
      memo: "within-100m-test",
    },
  },
  {
    name: "OVER (>100m) 기대: CORRECTION_REQUESTED/applied=false",
    body: {
      siteId: "1",
      userId: "1",
      // 주의: 원본과 충분히 떨어지게(>100m) 입력하세요.
      proposedLat: 37.5665,
      proposedLon: 126.9780,
      accuracyM: 12,
      memo: "over-100m-test",
    },
  },
];

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  return { statusCode: res.status, json };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  console.log(`BASE_URL = ${BASE_URL}`);
  console.log(`POST     = ${ENDPOINT}`);
  console.log("");

  for (const t of TESTS) {
    console.log(`=== ${t.name} ===`);
    console.log("request.body =", t.body);

    const { statusCode, json } = await postJson(ENDPOINT, t.body);

    console.log("http.status =", statusCode);
    console.log("response   =", json);

    // ✅ 최소 완료 판정(응답 기준)
    assert(statusCode === 200, `HTTP ${statusCode} (200 expected)`);

    if (t.name.startsWith("WITHIN")) {
      assert(json?.success === true, "WITHIN: success=true expected");
      assert(json?.status === "APPROVED", "WITHIN: status=APPROVED expected");
      assert(json?.applied === true, "WITHIN: applied=true expected");
    } else if (t.name.startsWith("OVER")) {
      assert(json?.success === true, "OVER: success=true expected");
      assert(
        json?.status === "CORRECTION_REQUESTED",
        "OVER: status=CORRECTION_REQUESTED expected"
      );
      assert(json?.applied === false, "OVER: applied=false expected");
    }

    console.log("✅ PASS\n");
  }

  console.log("ALL TESTS PASSED.");
})().catch((e) => {
  console.error("❌ TEST FAILED:", e?.message || e);
  process.exit(1);
});
