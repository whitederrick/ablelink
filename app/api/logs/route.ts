// app/api/logs/route.ts
// 훈련생 로그 기록 및 시간 자동 계산 API (점심 차감 및 연장 포함 버전)

export const runtime = "nodejs";

import { NextResponse } from 'next/server';
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      userId,          // 작성자 ID (User.id)
      traineeId,       // 대상 훈련생 ID
      attendanceId,    // 해당 일자 출근부 ID
      time1on1,        // 사용자가 입력한 1:1 지도 시간 (단순 버전은 0 또는 전체)
      extTime1on1,     // 1:1 연장 지도 시간
      extTimeGroup,    // 1:多 연장 지도 시간
      guidanceContent, // 지도 내용 (스키마: content)
      taskScores,      // 수행 과제 배열 [{ content: "과제명", score: 5 }]
      evaluation       // 총평 (스키마: evaluation)
    } = body;

    // 1. 해당 일자의 출퇴근 기록 조회 [cite: 711-713]
    const attendance = await prisma.dailyAttendance.findUnique({
      where: { id: BigInt(attendanceId) },
    });

    if (!attendance || !attendance.startTime || !attendance.endTime) {
      return NextResponse.json({ error: '출퇴근 기록이 확인되지 않습니다.' }, { status: 400 });
    }

    // 2. [비즈니스 로직] 시간 자동 계산 [cite: 900-903]
    
    // 2-1. 총 체류 시간 계산 (ms -> hours)
    const totalStayMs = attendance.endTime.getTime() - attendance.startTime.getTime();
    let baseWorkHours = totalStayMs / (1000 * 60 * 60); 

    // 2-2. 휴게시간(점심) 차감 정책 반영: 5시간 이상 체류 시 1시간 자동 차감 [cite: 165, 254]
    if (baseWorkHours >= 5) {
      baseWorkHours -= 1;
    }

    // 2-3. 1:多 지도 시간 자동 산출 [cite: 329, 603]
    // 기본 근무 시간(점심 제외) 중 1:1 지도를 제외한 나머지는 모두 1:多 시간으로 처리
    let calculatedTimeGroup = baseWorkHours - Number(time1on1);
    if (calculatedTimeGroup < 0) calculatedTimeGroup = 0;

    // 2-4. 최종 공단 인정 시간 합산 (8시간 초과 가능) 
    // 인정 시간 = (기본 근무 - 점심) + 1:1 연장 + 1:多 연장
    const totalRecognized = baseWorkHours + Number(extTime1on1) + Number(extTimeGroup); 

    // 3. 데이터베이스 저장 (트랜잭션 처리) 
    const result = await prisma.$transaction(async (tx) => {
      // 3-1. 훈련일지 메인 데이터 생성 [cite: 1170-1191]
      const log = await tx.traineeLog.create({
        data: {
          traineeId: BigInt(traineeId),
          attendanceId: BigInt(attendanceId),
          writerId: BigInt(userId),               // 작성자(지도원) ID 기록
          trainingType: 'FIELD',                  // 현장 훈련 [cite: 231, 770]
          time1on1: Number(time1on1),
          timeGroup: Number(calculatedTimeGroup), // 서버 자동 계산 값 [cite: 1180]
          extTime1on1: Number(extTime1on1),
          extTimeGroup: Number(extTimeGroup),
          totalRecognizedTime: totalRecognized,   // 최종 인정 시간 [cite: 798, 1183]
          content: guidanceContent,               // 지도 내용 필드 매핑
          evaluation: evaluation,                 // 총평 필드 매핑
          isCompleted: true                       // 작성 완료 상태 기록 [cite: 1186]
        },
      });

      // 3-2. 상세 수행 과제 데이터 생성 [cite: 811-813]
      if (taskScores && taskScores.length > 0) {
        for (const task of taskScores) {
          await tx.traineeLogTask.create({
            data: {
              logId: log.id,
              taskName: task.content,             // 과제 내용 (스키마: taskName)
              performanceScore: Number(task.score), // 수행 정도 (스키마: performanceScore)
            },
          });
        }
      }
      return log;
    });

    return NextResponse.json({ success: true, data: result });

  } catch (error) {
    console.error('훈련일지 저장 중 서버 오류:', error);
    return NextResponse.json({ error: '데이터 저장에 실패했습니다.' }, { status: 500 });
  }
}