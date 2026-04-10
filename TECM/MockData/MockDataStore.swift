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

    static let notifications: [ParentNotification] = [
        .init(title: "您的試堂預約已提交，正在確認中", time: "2小時前"),
        .init(title: "下週家長日提醒：請於 App 確認出席", time: "昨天")
    ]


    static let multipleChoiceQuestions: [MultipleChoiceQuestion] = [
        .init(
            prompt: "孩子在閱讀英文短文時，先做哪一步最有助理解內容？",
            options: ["先看標題與圖片", "先逐字翻譯", "直接背誦全文"],
            correctIndex: 0,
            explanation: "先看標題與圖片能快速建立語境，再閱讀細節會更容易掌握重點。"
        )
    ]

    static let trueFalseQuestions: [TrueFalseQuestion] = [
        .init(
            prompt: "固定而短時間的日常練習，通常比一次長時間學習更有效。",
            answer: true,
            explanation: "穩定而可持續的練習有助記憶鞏固，也更符合孩子日常節奏。"
        )
    ]

}
