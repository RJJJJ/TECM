import Foundation

enum MockDataStore {
    static let news: [NewsItem] = [
        .init(title: "2026 暑期課程現已開放登記", date: "2026年4月8日"),
        .init(title: "家長講座：如何建立孩子閱讀習慣", date: "2026年4月2日")
    ]

    static let courses: [Course] = [
        .init(title: "幼兒雙語啟蒙", ageGroup: "3-5歲", category: "語言", summary: "透過情境互動建立英語與中文基礎語感。", schedule: "逢星期六 10:00-11:30", campus: "氹仔校區"),
        .init(title: "小學數理思維", ageGroup: "6-8歲", category: "STEM", summary: "強化邏輯推理與問題解決能力。", schedule: "逢星期三 16:00-17:30", campus: "澳門半島校區"),
        .init(title: "公開演說與表達", ageGroup: "9-12歲", category: "溝通", summary: "培養自信表達與演說結構能力。", schedule: "逢星期五 17:00-18:30", campus: "路氹城校區")
    ]

    static let faq: [FAQItem] = [
        .init(question: "如何預約試堂？", answer: "可在「預約」頁面選擇年齡組別、課程及時段後提交。"),
        .init(question: "試堂需要收費嗎？", answer: "部分課程提供免費試堂，實際安排會於確認通知中說明。"),
        .init(question: "如何選擇合適課程？", answer: "TECM AGENT 可先提供建議，中心顧問亦會按孩子需要跟進。")
    ]

    static let bookings: [BookingRecord] = [
        .init(parentName: "陳太", childAgeGroup: "6-8歲", courseName: "小學數理思維", campus: "澳門半島校區", timeSlot: "2026/04/18 16:00", status: .pending),
        .init(parentName: "李先生", childAgeGroup: "3-5歲", courseName: "幼兒雙語啟蒙", campus: "氹仔校區", timeSlot: "2026/04/13 10:00", status: .confirmed),
        .init(parentName: "黃太", childAgeGroup: "9-12歲", courseName: "公開演說與表達", campus: "路氹城校區", timeSlot: "2026/04/05 17:00", status: .completed)
    ]



    static let multipleChoiceQuestions: [MultipleChoiceQuestion] = [
        .init(
            prompt: "在閱讀文章時，先看標題最主要的作用是什麼？",
            optionTexts: ["記住所有細節", "先掌握文章主題", "跳過第一段", "只看插圖"],
            correctIndex: 1,
            explanation: "先看標題可快速建立閱讀方向，幫助孩子理解重點。"
        ),
        .init(
            prompt: "孩子做數學應用題時，第一步較合適的是？",
            optionTexts: ["立刻列算式", "先圈出關鍵條件", "先猜答案", "直接問同學"],
            correctIndex: 1,
            explanation: "先找出關鍵條件，能降低誤解題意的機會。"
        ),
        .init(
            prompt: "練習英語口說時，哪個方式更有助建立信心？",
            optionTexts: ["只糾正文法錯誤", "先完成短句表達再微調", "一次背完整段落", "避免開口"],
            correctIndex: 1,
            explanation: "先鼓勵完整表達，再調整細節，較能建立持續練習動機。"
        ),
        .init(
            prompt: "課後複習安排中，哪個策略更有效？",
            optionTexts: ["一次讀兩小時", "每天短時間回顧重點", "考前才整理", "只看錯題答案"],
            correctIndex: 1,
            explanation: "短時高頻回顧能幫助記憶穩定，也較容易長期維持。"
        )
    ]

    static let trueFalseQuestions: [TrueFalseQuestion] = [
        .init(
            prompt: "孩子遇到不懂的題目時，先描述自己理解到哪一步，是有效學習行為。",
            answer: true,
            explanation: "先說出思路可讓老師更快定位盲點，也能建立問題表達能力。"
        ),
        .init(
            prompt: "只要做很多題目，不需要整理錯誤原因也能穩定進步。",
            answer: false,
            explanation: "整理錯誤原因是關鍵，能避免重複犯同樣的錯誤。"
        ),
        .init(
            prompt: "學習節奏越快越好，休息時間可以完全省略。",
            answer: false,
            explanation: "適度休息能提升專注與吸收品質，是有效學習的一部分。"
        ),
        .init(
            prompt: "家長以鼓勵和具體回饋取代單純比較，通常更能提升孩子學習意願。",
            answer: true,
            explanation: "具體且正向的回饋可建立成就感，讓孩子更願意持續投入。"
        )
    ]

    static let notifications: [ParentNotification] = [
        .init(title: "您的試堂預約已提交，正在確認中", time: "2小時前"),
        .init(title: "下週家長日提醒：請於 App 確認出席", time: "昨天")
    ]
}
