# MR-AR 화상통화 협업 기능 작업 기록

## 프로젝트 구성
- **MR (VR 헤드셋)**: `D:\UnityProject\Unity_new_version`
- **AR (INMO 스마트글래스)**: `D:\UnityProject\My project (5)`
- **서버**: `C:\Users\leote\Desktop\.해담\02개발용\TempServer` (Node.js WebSocket 릴레이 - `ws.js`, 정적 파일 서빙 - `files.js`, 업로드 폴더 - `uploads/`)

MR↔AR은 서버(`ws.js`)를 통해 WebSocket으로 메시지를 주고받는다. `?platform=MR` / `?platform=AR`로 접속을 구분하고, 서버는 받은 메시지를 그대로 상대 플랫폼에 릴레이만 한다.

---

## 지금까지 한 것

### 1. 초기 문제 해결 (GLB 전송 실패)
- MR→AR 3D 모델 전송 시 "불러오기 실패: Data Processing Error" 오류 → 원인 체인: 오래된 빌드 설치 → 패키지명 대소문자 불일치(`com.DefaultCompany.MyProject4` vs `Myproject4`) → Vuforia 템플릿 오염 → **새 AR 프로젝트("My project (5)")로 마이그레이션** → 네이티브 플러그인/패키지 누락 → Player Settings 문제 → glTFast 셰이더 스트리핑(핑크 텍스처)까지 순차적으로 해결.

### 2. MR→AR 실시간 3D 모델 협업 기능 ("테스트" 메뉴로 구현, 실제 화상통화와 분리)
- **회전 동기화**: MR이 컨트롤러로 모델을 잡고 돌리면 AR에도 실시간 반영 (`model_rotate` 메시지, 15Hz 스로틀)
- **부위 하이라이트**: MR이 컨트롤러 레이로 특정 부위를 가리키면 그 부위가 단색으로 하이라이트
- **포인터 마커**: 하이라이트와 별개로, 가리킨 정확한 지점에 빨간 구슬 마커 표시 (AR은 TestMenu에 "모델 회전 테스트"/"모델 포인터 테스트" 두 항목으로 분리, MR은 패널 안 토글 버튼 하나로 전환)
- **분해도(exploded view)**: MR에서 "분해도 보기" 버튼 → AR에도 분해 애니메이션 동기화 (`model_explode` 메시지) - **⚠️ 8/18 기준 AR에서 분해가 안 보이는 버그 있음, 다음 세션에서 확인 필요**
- 표시 대상 3D 모델: Duck → ToyCar → 실제 펌프(`pump_export.glb`, `PumpGltfExporter.cs`로 MR.unity의 pump1을 GLB로 추출) → **컨트롤러**(`controller_export.glb`, `ControllerGltfExporter.cs`로 XR Interaction Toolkit 샘플의 `XR Controller Right.prefab`을 추출, 씬에 안 넣고 코드로 바로 인스턴스화)로 순차 교체
- 마커가 표면 안에 파묻히는 문제 → MR이 레이캐스트 히트의 표면 법선(normal)을 함께 전송해서 그 방향으로 마커를 밀어내는 방식으로 해결
- 마커 크기가 모델 원본 크기에 따라 들쭉날쭉하던 문제(컨트롤러로 바꾸니 마커가 화면을 뒤덮을 만큼 커짐) → `modelRoot.localScale`로 나눠서 항상 "화면에 보이는 실제 크기" 기준으로 계산하도록 수정 (AR: `ModelRotateTestDemo.cs`, MR: `ModelRotateTestPanel.cs`)

### 3. 화상통화 UI 전면 개편
- **AR 목업** (`VideoCallMockupDemo.cs`, 테스트 메뉴 "화상통화 목업(유지보수)"): 수신/발신 시뮬레이션 + 통화중 화면(매뉴얼/파일/3D모델 탭)을 실제 통화 로직 없이 미리보기
- **AR 실제 통화 화면** (`InmoCallManager.cs`): 기존 프리팹(`CallPanel.prefab`) 기반 UI를 완전히 걷어내고 코드 생성 UI로 교체. Agora/시그널링 로직은 그대로 유지. 오른쪽 640px 고정폭 도크에만 UI를 배치하고 나머지는 항상 순검정(광학 시스루 AR에서 실제로 투명하게 보임)으로 둬서 "중앙에서 실제 현실이 보여야 한다"는 요구 충족
  - 도크 구성(위→아래): 유지보수명/진행상태 텍스트 → 셀프 카메라 미리보기 → 매뉴얼/파일/3D모델 탭 → 탭별 콘텐츠 카드 → 마이크/스피커/통화종료
  - 매뉴얼 탭: 실제 `guide_step` 수신 시 표시 (샘플 데이터 없음, 대기 문구만)
  - 파일 탭: 작은 미리보기 자동 표시 + "크게보기" 버튼을 눌러야만 전체화면(`InmoFileDisplay`)이 뜨도록 분리 (예전엔 작은 미리보기와 전체화면이 동시에 자동으로 떠서 중복이었음)
  - 3D모델 탭: `ModelRotateTestDemo`를 도크 카드 안에 임베드(전체화면 아님) - `ModelRotateTestDemo.Init(markerMode, embedParent)`에 embedParent 옵션 추가해서 지원
  - 탭 선택 시 테두리 표시, MR발 새 신호 있을 때 탭 위 빨간 점 배지
  - 안경다리(터치패드) 좌우 이동으로 매뉴얼/파일/3D모델/마이크/스피커/종료 전부 조작 가능 (`inCallFocusIndex`, `RefreshInCallFocus`, `ActivateInCallFocus`)
  - 라이트/다크 테마 전환 버튼 (왼쪽 위, 항상 클릭 가능하게 uiRoot 밖에 배치)
- **`InmoUiTheme.cs`**: 다크(기존)/라이트 두 팔레트 추가, `IsLight` 플래그로 전환. `RealWorldPassthrough`(항상 고정 검정)를 별도로 둬서 전체화면 배경은 테마와 무관하게 항상 검정 유지(라이트 모드에서도 중앙이 하얗게 막히지 않도록)
- **버튼 클릭 안정성**: 수동 `EventSystem.RaycastAll` 방식 → Unity 표준 `Button.onClick`으로 전면 교체 (`InmoFileDisplay` 닫기 버튼 포함)
  - ⚠️ 그래도 실기기(글래스)에서 마우스/클릭 기반 버튼(테마 전환, 파일 닫기)이 안 눌리는 문제가 있었음 - **추정 원인: 글래스 안경다리 터치패드는 좌표 개념이 없는 제스처(탭/스와이프)만 보내므로, 좌표 기반 클릭(Button.onClick)은 실기기에서 애초에 도달할 수 없는 구조일 가능성이 높음.** 안경다리로 조작 가능한 요소(탭/마이크/스피커/종료)는 키보드 등가 경로(`inmolib_common.Input`)가 있어서 되는 것처럼 보였던 것 - 진짜 마우스 클릭 테스트는 PC/에디터 Play 모드에서 해야 함. 다음 세션에서 테마 버튼/닫기 버튼에도 안경다리 경로를 추가하는 작업 필요.

### 4. 건전지 교체 데모 시나리오로 전환
- MR `WorkGuidePanel.cs`의 `ActiveSteps`를 펌프 점검 → 컨트롤러 건전지 교체 6단계로 교체 (이전/다음 네비게이션은 이미 있었음)
- AR `VideoCallMockupDemo.cs`의 `SampleManualSteps`도 동일하게 교체
- AR 오른쪽 상단에 "유지보수명: 건전지 교체 / 작업 진행상태: 진행중" 텍스트 추가 (`InmoCallManager.cs`, `VideoCallMockupDemo.cs` 둘 다) - **⚠️ 8/18 스크린샷에서 실제로 안 보였음, 다음 세션에서 빌드 확인 필요**

### 5. MR 화면 통일
- `MrUiTheme.cs` / `MrIconFactory.cs` 신규 생성 (AR `InmoUiTheme`/`InmoIconFactory`와 동일한 색 팔레트 - 원래 AR 색 자체가 MR에서 승인받은 색을 옮긴 것이라 원본을 유틸리티로 정리)
- `WorkGuidePanel.cs`(작업가이드) / `LiveDrawOverlay.cs`(실시간 그리기) / `ModelRotateTestPanel.cs`(모델회전모드) 세 패널의 색/둥근모서리/HUD 거리(Z)·스케일을 통일

---

## 다음 세션(8/18)에 이어서 할 것

**최우선: 마지막 요구사항들 빌드해서 실기기로 테스트해보기** (이번 세션엔 코드만 짜고 실기 확인을 못 함)

1. **선택 버튼 테두리 규칙 정정**: select된 버튼은 지금처럼 하늘색(Accent)으로 유지. 그런데 select되기 *전에* 안경다리로 포커스가 이동해서 버튼이 커지는 단계가 있는데, 그때 테두리가 생겨야 한다고 함 ("내가 잘못 말했던 것 같아" - 이전에 "선택된 버튼만 테두리"라고 했던 걸 정정하는 것으로 보임). → `InmoCallManager.cs`의 `RefreshInCallFocus()`(포커스 확대) 쪽에 테두리 토글을 다시 추가해야 함. `SelectTab()`의 테두리 로직과 관계 정리 필요(포커스 테두리 vs 선택 테두리가 동시에 필요한지 확인).

2. **분해도(exploded view)가 AR 글래스에서 안 보임**: MR에서 분해 버튼을 눌러도 AR 쪽에 반영이 안 되는 것으로 보임. `model_explode` 메시지 흐름(MR `SendModelExplode` → 서버 릴레이 → AR `OnModelExplodeReceived` → `ModelRotateTestDemo.HandleModelExplode`)을 처음부터 다시 점검. 예전에 이미 한 번 디버깅해서 고쳤던 이력이 있는 기능이라, 이번 컨트롤러 모델 교체나 다른 리팩터링 과정에서 회귀됐을 가능성 있음.

3. **건전지 3D 모델도 보여주면 좋겠음**: 지금은 컨트롤러 모델만 있음. 건전지 자체도 별도 3D 모델(혹은 컨트롤러 모델의 일부로 분해도에서 분리되어 나오는 파츠)로 보여주는 방안 검토.

4. **AR 우측 상단 유지보수명/상태 텍스트 재확인**: 이미 코드는 넣었는데(`InmoCallManager.cs`, `VideoCallMockupDemo.cs`) 실기 스크린샷에서 안 보였음 - 빌드가 최신 코드를 반영 못 했을 가능성이 높음. 재빌드 후 확인.

5. **MR 3개 패널(실시간 그리기/모델회전모드/작업가이드) 완전히 정리**:
   - 지금 `ModelRotateTestPanel`의 토글 버튼이 앱 시작부터 항상 떠 있음 → **화상통화가 시작될 때만** 뜨도록 변경해야 함 (`LiveDrawOverlay`/`WorkGuidePanel`처럼 `VideoCallSignalingMR.OnCallAccepted`/`OnCallEnded` 이벤트에 연결).
   - `WorkGuidePanel`이 화면에서 너무 큼 → 크기 축소.
   - 실시간 그리기·작업가이드·모델회전 테스트 세 패널이 레이아웃상 서로 겹치면 안 됨 - HUD 위치(Y 오프셋)를 셋이 겹치지 않게 재배치.

---

## 참고 - 알아두면 좋은 것
- Unity 코드 수정 후에는 **반드시 재빌드/재설치**해야 실기기에 반영됨(핫리로드 없음) - 이번 세션에서 "고쳤는데 여전히 안 됨" 보고가 여러 번 있었는데, 재빌드 전 상태를 테스트한 경우가 섞여있었을 가능성 있음.
- 서버(`ws.js`) 코드를 고치면 Node 프로세스를 수동으로 재시작해야 함(핫리로드 없음).
- 안경다리(터치패드) 입력은 `inmolib_common.Input`으로 좌우 화살표/엔터/이스케이프 4가지 제스처만 사용 가능 - 좌표 기반(마우스 클릭) 입력은 실기기에서 근본적으로 안 될 가능성이 큼. 새 인터랙티브 요소를 만들 땐 항상 이 4개 키로도 조작 가능하게 만드는 게 안전.
