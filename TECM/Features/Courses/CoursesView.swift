import SwiftUI

struct CoursesView: View {
    private let ageGroups = ["全部", "3-5歲", "6-8歲", "9-12歲"]

    @State private var selectedAge = "全部"

    private var filteredCourses: [Course] {
        selectedAge == "全部" ? MockDataStore.courses : MockDataStore.courses.filter { $0.ageGroup == selectedAge }
    }

    var body: some View {
        ScreenContainer(title: "課程") {
            SectionHeader(title: "年齡分組", subtitle: "快速篩選合適課程")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.Spacing.sm) {
                    ForEach(ageGroups, id: \.self) { group in
                        Button {
                            selectedAge = group
                        } label: {
                            TagChip(title: group, isSelected: selectedAge == group)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                SectionHeader(title: "課程列表", subtitle: "分類、時間及校區一目了然")
                ForEach(filteredCourses) { course in
                    InfoCard {
                        HStack {
                            Text(course.title)
                                .font(.headline)
                            Spacer()
                            TagChip(title: course.category)
                        }
                        Text(course.summary)
                            .foregroundStyle(Theme.Colors.textSecondary)
                        Text("年齡：\(course.ageGroup)")
                        Text("時間：\(course.schedule)")
                        Text("校區：\(course.campus)")
                            .foregroundStyle(Theme.Colors.textSecondary)
                        NavigationLink(destination: BookingView()) {
                            Text("預約試堂")
                                .fontWeight(.semibold)
                                .foregroundStyle(Theme.Colors.primaryBlue)
                        }
                        .padding(.top, Theme.Spacing.xs)
                    }
                }
            }
        }
    }
}
