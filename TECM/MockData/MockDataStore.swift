import Foundation

enum MockDataStore {
    static let courses: [Course] = [
        .init(title: "幼兒雙語啟蒙", category: "語言發展", level: "Foundation", ageGroup: "3-5歲", focusTags: ["語感", "表達"], summary: "透過故事與互動情境，建立孩子穩定的雙語理解與自信表達。", schedule: "星期六 10:00-11:30", campus: "氹仔校區", recommended: true),
        .init(title: "小學數理思維", category: "邏輯思維", level: "Core", ageGroup: "6-8歲", focusTags: ["推理", "解題策略"], summary: "以生活化題材引導邏輯建構，提升分析能力而非單純刷題。", schedule: "星期三 16:00-17:30", campus: "澳門半島校區", recommended: true),
        .init(title: "公開演說與表達", category: "溝通素養", level: "Advanced", ageGroup: "9-12歲", focusTags: ["演說", "結構思考"], summary: "建立上台表達與觀點組織能力，強化溝通自信。", schedule: "星期五 17:00-18:30", campus: "路氹城校區", recommended: false),
        .init(title: "學術閱讀工作坊", category: "語文閱讀", level: "Core", ageGroup: "9-12歲", focusTags: ["閱讀", "摘要"], summary: "訓練重點整理與精準理解，協助孩子建立長期學習方法。", schedule: "星期日 11:00-12:30", campus: "澳門半島校區", recommended: false)
    ]

    static let bookings: [BookingRecord] = [
        .init(parentName: "陳太", childName: "昊昊", childAgeGroup: "6-8歲", courseName: "小學數理思維", campus: "澳門半島校區", timeSlot: "2026/04/18 16:00", status: .pending),
        .init(parentName: "李先生", childName: "芊芊", childAgeGroup: "3-5歲", courseName: "幼兒雙語啟蒙", campus: "氹仔校區", timeSlot: "2026/04/13 10:00", status: .confirmed),
        .init(parentName: "黃太", childName: "子言", childAgeGroup: "9-12歲", courseName: "公開演說與表達", campus: "路氹城校區", timeSlot: "2026/04/05 17:00", status: .completed)
    ]

    static let notifications: [ParentNotification] = [
        .init(title: "預約已提交", detail: "您的試堂申請已進入人工確認流程。", time: "2小時前"),
        .init(title: "課前提醒", detail: "下週課程需攜帶閱讀教材，詳見課程通知。", time: "昨天")
    ]

    static let faq: [FAQItem] = [
        .init(topic: "預約", question: "如何預約試堂？", answer: "前往「預約」頁面選擇課程與時段後提交，顧問會於 24 小時內確認。", popular: true),
        .init(topic: "收費", question: "試堂需要收費嗎？", answer: "部分課程提供體驗名額，實際收費會在預約確認時清楚說明。", popular: true),
        .init(topic: "選課", question: "如何判斷孩子適合哪一類課程？", answer: "您可先瀏覽課程頁摘要，或透過 TECM AGENT 查看常見建議後再與顧問確認。", popular: false),
        .init(topic: "家長支援", question: "可以查看孩子近期學習建議嗎？", answer: "可以，家長中心會提供近期課程摘要與延伸學習入口。", popular: false)
    ]

    static let learningResources: [LearningResource] = [
        .init(title: "本週延伸閱讀", description: "搭配課程主題的短篇閱讀與提問。", estimatedTime: "10 分鐘"),
        .init(title: "親子口語練習", description: "家長可陪同完成的雙語對話卡。", estimatedTime: "8 分鐘")
    ]

    static let practiceSubjects: [PracticeSubject] = [
        PracticeSubject(
            id: "python",
            title: "Python",
            subtitle: "程式思維入門",
            iconName: "chevron.left.forwardslash.chevron.right",
            description: "以語法基礎與流程理解為主，建立孩子的程式表達能力。",
            papers: [
                PracticePaper(
                    subjectId: "python",
                    title: "Python 入門練習卷",
                    levelLabel: "初階",
                    audience: "9-12歲",
                    estimatedMinutes: 8,
                    questions: [
                        .init(type: .singleChoice, prompt: "在 Python 中，哪一個函式可以把文字輸出到畫面？", options: ["print()", "input()", "open()", "range()"], correctAnswer: 0, explanation: "print() 用於顯示訊息，是最常見的輸出方式。"),
                        .init(type: .trueFalse, prompt: "Python 變數命名可以包含底線 _。", correctAnswer: 0, explanation: "底線是合法字元，常用於提升命名可讀性。"),
                        .init(type: .singleChoice, prompt: "若 x = 3，哪一段判斷會回傳 True？", options: ["x > 5", "x == 3", "x != 3", "x < 0"], correctAnswer: 1, explanation: "x == 3 會檢查是否等於 3，因此條件成立。"),
                        .init(type: .singleChoice, prompt: "以下哪個是 Python 的串列（list）表示法？", options: ["(1, 2, 3)", "{1, 2, 3}", "[1, 2, 3]", "<1, 2, 3>"], correctAnswer: 2, explanation: "中括號 [] 是 list 的標準語法。"),
                        .init(type: .trueFalse, prompt: "for 迴圈常用來重複執行同一段程式。", correctAnswer: 0, explanation: "for 迴圈可以逐次處理資料，是重複邏輯的核心工具。"),
                        .init(type: .singleChoice, prompt: "程式出現錯誤訊息時，第一步較合適的是？", options: ["直接刪掉程式", "先閱讀錯誤提示再定位行數", "全部重寫", "忽略錯誤繼續執行"], correctAnswer: 1, explanation: "先看錯誤訊息可快速縮小問題範圍。")
                    ]
                ),
                PracticePaper(
                    subjectId: "python",
                    title: "Python 基礎語法練習卷",
                    levelLabel: "初中階",
                    audience: "10-13歲",
                    estimatedMinutes: 10,
                    questions: [
                        .init(type: .singleChoice, prompt: "哪個關鍵字可用於函式回傳結果？", options: ["break", "return", "yield", "pass"], correctAnswer: 1, explanation: "return 會將函式結果傳回呼叫端。"),
                        .init(type: .singleChoice, prompt: "if/elif/else 結構主要用途是？", options: ["建立清單", "進行條件分支", "輸入資料", "儲存檔案"], correctAnswer: 1, explanation: "條件分支可讓程式依不同情況採取不同動作。"),
                        .init(type: .trueFalse, prompt: "Python 的縮排不影響程式執行結果。", correctAnswer: 1, explanation: "縮排決定程式區塊，錯誤縮排會直接造成語法問題。"),
                        .init(type: .singleChoice, prompt: "要把字串 " + "\"42\" 轉為整數，應使用哪個函式？", options: ["str()", "int()", "float()", "bool()"], correctAnswer: 1, explanation: "int() 會將可轉換的字串改為整數型別。"),
                        .init(type: .trueFalse, prompt: "函式可以重複使用，有助於整理程式結構。", correctAnswer: 0, explanation: "把重複邏輯放入函式，可提升維護性。"),
                        .init(type: .singleChoice, prompt: "當不確定資料型別時，先用哪個方式最實用？", options: ["猜測", "type() 檢查", "直接刪資料", "改用 C++"], correctAnswer: 1, explanation: "type() 可快速確認資料型別，避免運算錯誤。")
                    ]
                )
            ]
        ),
        PracticeSubject(
            id: "scratch",
            title: "Scratch",
            subtitle: "邏輯積木與互動設計",
            iconName: "square.stack.3d.up",
            description: "透過視覺化積木建立順序、條件、事件與角色互動概念。",
            papers: [
                PracticePaper(
                    subjectId: "scratch",
                    title: "Scratch 邏輯積木練習卷",
                    levelLabel: "初階",
                    audience: "7-10歲",
                    estimatedMinutes: 8,
                    questions: [
                        .init(type: .singleChoice, prompt: "在 Scratch 中，要讓角色在開始時執行動作，常用哪個事件積木？", options: ["重複執行", "當綠旗被點擊", "如果那麼", "廣播訊息"], correctAnswer: 1, explanation: "綠旗事件常作為專案啟動入口。"),
                        .init(type: .trueFalse, prompt: "角色外觀積木只能改變顏色，不能切換造型。", correctAnswer: 1, explanation: "外觀積木可切換造型，也能改大小或特效。"),
                        .init(type: .singleChoice, prompt: "要讓角色一直往右移動，哪種結構最合適？", options: ["重複執行 + 移動", "只放一次移動", "等待積木", "停止全部"], correctAnswer: 0, explanation: "需搭配重複執行，角色才會持續移動。"),
                        .init(type: .singleChoice, prompt: "當角色碰到邊緣要反彈，主要使用哪類積木？", options: ["運算", "音效", "動作", "偵測"], correctAnswer: 2, explanation: "反彈指令位於動作積木中，常搭配偵測條件。"),
                        .init(type: .trueFalse, prompt: "廣播訊息可用來同步多個角色的行為。", correctAnswer: 0, explanation: "廣播是多角色協作常用方式。"),
                        .init(type: .singleChoice, prompt: "若要控制遊戲分數，最適合使用？", options: ["清單", "變數", "造型", "畫筆"], correctAnswer: 1, explanation: "分數會隨流程更新，使用變數最直觀。")
                    ]
                ),
                PracticePaper(
                    subjectId: "scratch",
                    title: "Scratch 互動動畫練習卷",
                    levelLabel: "初中階",
                    audience: "8-11歲",
                    estimatedMinutes: 9,
                    questions: [
                        .init(type: .singleChoice, prompt: "要讓角色被點擊時說話，應搭配哪個事件？", options: ["當角色被點擊", "當空白鍵按下", "當背景切換", "當計時器歸零"], correctAnswer: 0, explanation: "點擊事件可直接回應使用者操作。"),
                        .init(type: .trueFalse, prompt: "等待積木可以幫助動畫節奏更自然。", correctAnswer: 0, explanation: "適當等待可讓動作有節奏，而不會瞬間完成。"),
                        .init(type: .singleChoice, prompt: "要在不同場景切換畫面，常用哪個元素？", options: ["背景", "清單", "運算式", "註解"], correctAnswer: 0, explanation: "背景切換可快速塑造場景變化。"),
                        .init(type: .singleChoice, prompt: "當條件成立才播音效，應使用哪種結構？", options: ["重複直到", "如果那麼", "等待", "廣播並等待"], correctAnswer: 1, explanation: "如果那麼可在條件成立時觸發指定行為。"),
                        .init(type: .trueFalse, prompt: "Scratch 專案不需要規劃流程，直接堆積木就能維持清楚邏輯。", correctAnswer: 1, explanation: "先規劃流程可避免邏輯混亂，提升專案品質。"),
                        .init(type: .singleChoice, prompt: "要讓角色每次移動都改變方向，最適合搭配？", options: ["隨機數", "固定數值", "停止程式", "重設變數"], correctAnswer: 0, explanation: "隨機數能讓方向變化更自然，提升互動感。")
                    ]
                )
            ]
        ),
        PracticeSubject(
            id: "cpp",
            title: "C++",
            subtitle: "結構化程式基礎",
            iconName: "cpu",
            description: "從型別、條件判斷到函式概念，建立較嚴謹的程式思維。",
            papers: [
                PracticePaper(
                    subjectId: "cpp",
                    title: "C++ 基礎判斷練習卷",
                    levelLabel: "初階",
                    audience: "11-14歲",
                    estimatedMinutes: 9,
                    questions: [
                        .init(type: .singleChoice, prompt: "在 C++ 中，哪個標頭常用於基本輸出？", options: ["<vector>", "<iostream>", "<map>", "<cmath>"], correctAnswer: 1, explanation: "cout 位於 iostream，是初學最常用的輸出工具。"),
                        .init(type: .trueFalse, prompt: "C++ 變數在使用前通常需要先宣告型別。", correctAnswer: 0, explanation: "型別宣告是 C++ 的核心特性，有助於編譯檢查。"),
                        .init(type: .singleChoice, prompt: "if (score >= 60) 的意思是？", options: ["score 小於 60", "score 大於或等於 60", "score 等於 60", "score 不等於 60"], correctAnswer: 1, explanation: ">= 代表大於或等於。"),
                        .init(type: .singleChoice, prompt: "以下哪個是正確的整數宣告？", options: ["int age;", "age int;", "integer age;", "num age;"], correctAnswer: 0, explanation: "C++ 宣告格式通常是 型別 + 名稱。"),
                        .init(type: .trueFalse, prompt: "== 在 C++ 中通常用於比較兩個值是否相等。", correctAnswer: 0, explanation: "比較要用 ==，單一 = 是賦值。"),
                        .init(type: .singleChoice, prompt: "學習 C++ 時，哪個習慣最有助於除錯？", options: ["忽略編譯警告", "每改一段就編譯一次", "一次寫到最後", "只看執行畫面"], correctAnswer: 1, explanation: "小步驟編譯可更快定位問題來源。")
                    ]
                ),
                PracticePaper(
                    subjectId: "cpp",
                    title: "C++ 迴圈與函式練習卷",
                    levelLabel: "初中階",
                    audience: "12-15歲",
                    estimatedMinutes: 10,
                    questions: [
                        .init(type: .singleChoice, prompt: "for 迴圈最適合用於哪種情境？", options: ["次數明確的重複", "隨機播放音效", "建立圖像介面", "上傳檔案"], correctAnswer: 0, explanation: "當次數可預期時，for 迴圈最清楚。"),
                        .init(type: .trueFalse, prompt: "函式可以接收參數，讓同一段邏輯更有彈性。", correctAnswer: 0, explanation: "參數能讓函式重複使用在不同資料上。"),
                        .init(type: .singleChoice, prompt: "while 迴圈會在什麼情況下持續執行？", options: ["條件為 true 時", "只執行一次", "每次都停止", "編譯失敗時"], correctAnswer: 0, explanation: "while 會持續檢查條件，為 true 才繼續。"),
                        .init(type: .singleChoice, prompt: "函式宣告 int add(int a, int b) 的回傳型別是？", options: ["a", "b", "int", "void"], correctAnswer: 2, explanation: "前面的 int 表示函式回傳整數。"),
                        .init(type: .trueFalse, prompt: "程式可讀性與命名品質，對團隊協作沒有影響。", correctAnswer: 1, explanation: "清楚命名能降低溝通成本，對協作非常重要。"),
                        .init(type: .singleChoice, prompt: "若要讓程式結構更清楚，較建議的作法是？", options: ["把所有邏輯寫在 main", "拆成小函式並加註解", "避免任何空行", "使用單字母命名"], correctAnswer: 1, explanation: "拆分功能與簡短註解可提升維護效率。")
                    ]
                )
            ]
        )
    ]
}
