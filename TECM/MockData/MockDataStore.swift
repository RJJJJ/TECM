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

    static let mcqQuestions: [MCQQuestion] = [
        .init(question: "在課堂表達中，先說結論再補充理由的好處是？", options: ["更清楚傳達重點", "句子變得更長", "不用聽別人意見"], answerIndex: 0),
        .init(question: "若題目要求比較兩個觀點，最好的做法是？", options: ["只寫自己喜歡的一方", "先找共同點再比較差異", "直接背答案"], answerIndex: 1)
    ]

    static let tfQuestions: [TFQuestion] = [
        .init(statement: "有效學習只靠大量做題，不需要反思。", isTrue: false),
        .init(statement: "固定而穩定的學習節奏有助於建立長期能力。", isTrue: true)
    ]
}
