import SwiftUI

struct RecipeDetailView: View {
  @Environment(AppSession.self) private var session
  @Environment(\.dismiss) private var dismiss
  @Bindable var recipe: LocalRecipe
  @State private var displayServings: Double?
  @State private var showTags = false
  @State private var showDelete = false
  @State private var errorMessage: String?
  @State private var showsCompactTitle = false

  var body: some View {
    GeometryReader { geometry in
      let heroHeight = geometry.size.width * 0.92
      let headerBottom = geometry.safeAreaInsets.top
      let headerHeight = max(headerBottom, 44)

      List {
        Section {
          VStack(spacing: 0) {
            RecipeImageView(recipe: recipe)
              .frame(width: geometry.size.width, height: heroHeight)
              .accessibilityIdentifier("detail.heroImage")

            VStack(alignment: .leading, spacing: 8) {
              if let genre = recipe.genre {
                Text(genre.rawValue)
                  .font(.caption.weight(.semibold))
                  .foregroundStyle(genre.badgeTint)
                  .padding(.horizontal, 10)
                  .padding(.vertical, 5)
                  .background(genre.badgeTint.opacity(0.16), in: Capsule())
                  .accessibilityIdentifier("detail.genreBadge")
              }

              Text(recipe.title)
                .font(.largeTitle.bold())
                .accessibilityIdentifier("detail.title")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 20)
            .padding(.vertical, 20)
            .background(Color(.systemBackground))
            .onGeometryChange(for: CGFloat.self) { proxy in
              proxy.frame(in: .global).maxY
            } action: { maxY in
              withAnimation(.easeInOut(duration: 0.2)) {
                showsCompactTitle =
                  maxY > 0 && maxY <= headerBottom + headerHeight + 8
              }
            }
          }
          .listRowInsets(EdgeInsets())
          .listRowSeparator(.hidden)
        }
        if recipe.analysisStatus == .failed {
          Section {
            Label("レシピの解析に問題がありました。", systemImage: "exclamationmark.triangle").foregroundStyle(
              .orange)
          }
        }
        if let raw = recipe.servingsRaw {
          Section {
            HStack {
              Text(servingsText(raw: raw))
                .accessibilityIdentifier("detail.servingsValue")
              if let base = recipe.servingsValue, base > 0 {
                Spacer()
                Stepper(
                  value: Binding(get: { displayServings ?? base }, set: { displayServings = $0 }),
                  in: 1...20
                ) {
                  EmptyView()
                }
                .labelsHidden()
                .accessibilityLabel("人数を変更")
                .accessibilityValue(servingsText(raw: raw))
                .accessibilityIdentifier("detail.servingsStepper")
              }
            }
          }
        }
        if let minutes = recipe.cookingTimeMinutes { Section("調理時間") { Text("\(minutes)分") } }
        Section {
          TagFlowLayout(spacing: 8) {
            Text("タグ")
              .font(.headline)
              .foregroundStyle(.secondary)
              .accessibilityIdentifier("detail.tagHeading")
            ForEach(recipe.tags) {
              Text("#\($0.name)")
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(.quaternary, in: Capsule())
            }
            Button {
              showTags = true
            } label: {
              Image(systemName: "plus.circle.fill")
                .font(.title3)
                .symbolRenderingMode(.hierarchical)
            }
            .accessibilityLabel("タグを追加")
            .accessibilityIdentifier("detail.addTag")
          }
          .padding(.vertical, 4)
        }
        if !recipe.ingredients.isEmpty {
          Section("材料") {
            ForEach(recipe.ingredients.sorted(by: { $0.sortOrder < $1.sortOrder })) { ingredient in
              HStack {
                Text(ingredient.name)
                Spacer()
                Text(scaledAmount(ingredient.amount) ?? "")
              }
            }
          }
        }
        if !recipe.steps.isEmpty {
          Section("作り方") {
            ForEach(recipe.steps.sorted(by: { $0.sortOrder < $1.sortOrder })) { step in
              Text("\(step.sortOrder + 1). \(step.text)")
            }
          }
        }
        Section("出典") {
          Link("元レシピを見る", destination: URL(string: recipe.originalUrl)!).accessibilityIdentifier(
            "detail.source")
        }
        Section {
          Button("レシピを削除", role: .destructive) { showDelete = true }
            .accessibilityIdentifier("detail.delete")
            .alert("このレシピを完全に削除しますか？", isPresented: $showDelete) {
              Button("削除", role: .destructive) {
                Task {
                  do {
                    try await session.repository.delete(id: recipe.id)
                    dismiss()
                  } catch { errorMessage = error.localizedDescription }
                }
              }
              Button("キャンセル", role: .cancel) {}
            }
        }
      }
      .listStyle(.plain)
      .contentMargins(.horizontal, 0, for: .scrollContent)
      .contentMargins(.top, 0, for: .scrollContent)
      .scrollEdgeEffectHidden(true, for: .top)
      .scrollContentBackground(.hidden)
      .ignoresSafeArea(edges: .top)
      .overlay(alignment: .top) {
        if showsCompactTitle {
          RecipeImageView(recipe: recipe)
            .frame(maxWidth: .infinity)
            .frame(height: headerHeight)
            .overlay(.black.opacity(0.14))
            .clipped()
            .ignoresSafeArea(edges: .top)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .transition(.opacity)
        }
      }
    }
    .navigationTitle("")
    .navigationBarTitleDisplayMode(.inline)
    .toolbarBackground(.hidden, for: .navigationBar)
    .toolbarColorScheme(.dark, for: .navigationBar)
    .toolbar {
      ToolbarItem(placement: .principal) {
        if showsCompactTitle {
          Text(recipe.title)
            .font(.headline)
            .lineLimit(1)
            .truncationMode(.tail)
            .accessibilityIdentifier("detail.compactTitle")
            .transition(.opacity)
        }
      }
      ToolbarItem(placement: .topBarTrailing) {
        if ![.pending, .processing].contains(recipe.analysisStatus) {
          NavigationLink(destination: RecipeEditView(recipe: recipe)) {
            Image(systemName: "pencil")
          }
          .accessibilityLabel("レシピを編集")
          .accessibilityIdentifier("detail.edit")
        }
      }
    }
    .sheet(isPresented: $showTags) { TagPickerSheet(recipe: recipe) }
    .alert(
      "エラー",
      isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })
    ) {
      Button("OK") {}
    } message: {
      Text(errorMessage ?? "")
    }
    .onAppear { displayServings = recipe.servingsValue }
  }
  private func servingsText(raw: String) -> String {
    guard let base = recipe.servingsValue, let displayServings else { return raw }
    guard displayServings != base else { return raw }
    return "\(displayServings.formatted(.number.precision(.fractionLength(0...2))))人分"
  }
  private func scaledAmount(_ amount: String?) -> String? {
    guard let base = recipe.servingsValue, let displayServings else { return amount }
    return AmountScaler.scale(amount, multiplier: displayServings / base)
  }
}

extension RecipeGenre {
  fileprivate var badgeTint: Color {
    switch badgeColor {
    case .red: Color(red: 0.78, green: 0.22, blue: 0.22)
    case .orange: Color(red: 0.82, green: 0.39, blue: 0.08)
    case .yellow: Color(red: 0.68, green: 0.49, blue: 0.02)
    case .purple: Color(red: 0.51, green: 0.27, blue: 0.76)
    case .blue: Color(red: 0.12, green: 0.43, blue: 0.78)
    case .green: Color(red: 0.14, green: 0.51, blue: 0.27)
    case .pink: Color(red: 0.76, green: 0.24, blue: 0.49)
    case .gray: Color.secondary
    }
  }
}

private struct TagPickerSheet: View {
  @Environment(AppSession.self) private var session
  @Environment(\.dismiss) private var dismiss
  let recipe: LocalRecipe
  @State private var name = ""
  @State private var tags: [LocalTag] = []
  @State private var error: String?
  private var availableTags: [LocalTag] {
    tags.filter { tag in !recipe.tags.contains(where: { $0.id == tag.id }) }
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 24) {
          VStack(alignment: .leading, spacing: 12) {
            Text("既存タグ")
              .font(.headline)
              .foregroundStyle(.secondary)

            if availableTags.isEmpty {
              Text("追加できる既存タグはありません")
                .font(.subheadline)
                .foregroundStyle(.tertiary)
            } else {
              TagFlowLayout(spacing: 8) {
                ForEach(availableTags) { tag in
                  Button("#\(tag.name)") { attach(tag.id) }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                }
              }
            }
          }

          Divider()

          VStack(alignment: .leading, spacing: 12) {
            Text("新しいタグ")
              .font(.headline)
              .foregroundStyle(.secondary)

            HStack(spacing: 12) {
              TextField("タグ名", text: $name)
                .textFieldStyle(.roundedBorder)
                .submitLabel(.done)
                .onSubmit(createAndAttach)
                .accessibilityIdentifier("tag.name")
              Button("追加") { createAndAttach() }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityIdentifier("tag.create")
            }
          }

          if let error {
            Text(error)
              .font(.footnote)
              .foregroundStyle(.red)
          }
        }
        .padding(20)
      }
      .navigationTitle("タグを追加")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { Button("閉じる") { dismiss() } }
      .onAppear { tags = (try? session.repository.allTags()) ?? [] }
    }
    .presentationDetents([.medium, .large])
    .presentationDragIndicator(.visible)
  }
  private func attach(_ id: String) {
    Task {
      do {
        _ = try await session.repository.attach(tagID: id, recipeID: recipe.id)
        dismiss()
      } catch { self.error = error.localizedDescription }
    }
  }
  private func createAndAttach() {
    let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedName.isEmpty else { return }
    Task {
      do {
        let tag = try await session.repository.createTag(name: trimmedName)
        _ = try await session.repository.attach(tagID: tag.id, recipeID: recipe.id)
        dismiss()
      } catch { self.error = error.localizedDescription }
    }
  }
}

private struct TagFlowLayout: Layout {
  let spacing: CGFloat

  func sizeThatFits(
    proposal: ProposedViewSize,
    subviews: Subviews,
    cache: inout ()
  ) -> CGSize {
    let result = layout(subviews: subviews, width: proposal.width ?? .infinity)
    return CGSize(width: proposal.width ?? result.width, height: result.height)
  }

  func placeSubviews(
    in bounds: CGRect,
    proposal: ProposedViewSize,
    subviews: Subviews,
    cache: inout ()
  ) {
    let result = layout(subviews: subviews, width: bounds.width)
    for (index, point) in result.points.enumerated() {
      subviews[index].place(
        at: CGPoint(x: bounds.minX + point.x, y: bounds.minY + point.y),
        anchor: .topLeading,
        proposal: .unspecified)
    }
  }

  private func layout(subviews: Subviews, width: CGFloat) -> (
    points: [CGPoint], width: CGFloat, height: CGFloat
  ) {
    let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
    var lines: [[Int]] = []
    var currentLine: [Int] = []
    var currentWidth: CGFloat = 0

    for index in sizes.indices {
      let size = sizes[index]
      let proposedWidth = currentLine.isEmpty ? size.width : currentWidth + spacing + size.width
      if !currentLine.isEmpty, proposedWidth > width {
        lines.append(currentLine)
        currentLine = [index]
        currentWidth = size.width
      } else {
        currentLine.append(index)
        currentWidth = proposedWidth
      }
    }
    if !currentLine.isEmpty { lines.append(currentLine) }

    var points = Array(repeating: CGPoint.zero, count: subviews.count)
    var y: CGFloat = 0
    var usedWidth: CGFloat = 0

    for line in lines {
      let lineHeight = line.map { sizes[$0].height }.max() ?? 0
      var x: CGFloat = 0
      for index in line {
        let size = sizes[index]
        points[index] = CGPoint(x: x, y: y + (lineHeight - size.height) / 2)
        x += size.width + spacing
      }
      usedWidth = max(usedWidth, x - spacing)
      y += lineHeight + spacing
    }

    return (points, usedWidth, max(0, y - spacing))
  }
}
