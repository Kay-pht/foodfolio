import SwiftUI

struct RecipeDetailView: View {
  @Environment(AppSession.self) private var session
  @Environment(\.dismiss) private var dismiss
  @Bindable var recipe: LocalRecipe
  @State private var displayServings: Double?
  @State private var showTags = false
  @State private var showDelete = false
  @State private var errorMessage: String?

  var body: some View {
    GeometryReader { geometry in
      let heroHeight = min(max(geometry.size.width * 0.72, 260), 320)

      ScrollView {
        VStack(spacing: 0) {
          RecipeImageView(recipe: recipe)
            .frame(width: geometry.size.width, height: heroHeight)
            .clipped()
            .accessibilityIdentifier("detail.heroImage")

          VStack(alignment: .leading, spacing: 24) {
            summarySection

            if recipe.analysisStatus == .failed {
              Label("レシピの解析に問題がありました。", systemImage: "exclamationmark.triangle")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.orange)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
            }

            if !recipe.ingredients.isEmpty {
              materialsSection
            }

            if !recipe.steps.isEmpty {
              stepsSection
            }

            sourceSection

            Button("レシピを削除", role: .destructive) { showDelete = true }
              .font(.subheadline.weight(.medium))
              .frame(maxWidth: .infinity)
              .padding(.vertical, 8)
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
          .padding(.horizontal, 20)
          .padding(.top, 18)
          .padding(.bottom, 40)
          .background(FoodfolioTheme.paper)
        }
      }
      .scrollIndicators(.hidden)
      .background(FoodfolioTheme.paper)
    }
    .ignoresSafeArea(edges: .top)
    .navigationTitle("")
    .navigationBarTitleDisplayMode(.inline)
    .tint(FoodfolioTheme.terracotta)
    .toolbar {
      ToolbarItem(placement: .principal) {
        Text(recipe.title)
          .font(.headline)
          .lineLimit(1)
          .truncationMode(.tail)
          .accessibilityIdentifier("detail.title")
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

  private var summarySection: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(spacing: 10) {
        if let genre = recipe.genre {
          Text(genre.rawValue)
            .font(.caption.weight(.semibold))
            .foregroundStyle(genre.badgeTint)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(genre.badgeTint.opacity(0.14), in: Capsule())
            .accessibilityIdentifier("detail.genreBadge")
        }

        if let minutes = recipe.cookingTimeMinutes {
          Label("\(minutes)分", systemImage: "clock")
            .font(.caption.weight(.semibold))
            .foregroundStyle(FoodfolioTheme.secondaryInk)
        }

        Spacer(minLength: 0)

        servingsControl
      }

      ScrollView(.horizontal) {
        HStack(spacing: 8) {
          Text("タグ")
            .font(.caption.weight(.semibold))
            .foregroundStyle(FoodfolioTheme.secondaryInk)
            .accessibilityIdentifier("detail.tagHeading")

          ForEach(Array(recipe.tags.enumerated()), id: \.element.id) { index, tag in
            Text("#\(tag.name)")
              .font(.subheadline.weight(.medium))
              .foregroundStyle(FoodfolioTheme.ink)
              .padding(.horizontal, 10)
              .padding(.vertical, 6)
              .background(tagBackground(index: index), in: Capsule())
          }

          Button {
            showTags = true
          } label: {
            Image(systemName: "plus")
              .font(.caption.bold())
              .frame(width: 30, height: 30)
              .glassEffect(.clear.interactive(), in: Circle())
          }
          .buttonStyle(.plain)
          .accessibilityLabel("タグを追加")
          .accessibilityIdentifier("detail.addTag")
        }
      }
      .scrollIndicators(.hidden)
    }
  }

  @ViewBuilder private var servingsControl: some View {
    if let raw = recipe.servingsRaw {
      if let base = recipe.servingsValue, base > 0 {
        HStack(spacing: 8) {
          Button {
            updateServings(by: -1, base: base)
          } label: {
            Image(systemName: "minus")
              .font(.caption.bold())
              .frame(width: 26, height: 26)
          }
          .buttonStyle(.plain)
          .disabled((displayServings ?? base) <= 1)
          .accessibilityLabel("人数を減らす")
          .accessibilityIdentifier("detail.servingsMinus")

          Text(servingsText(raw: raw))
            .font(.subheadline.weight(.semibold))
            .monospacedDigit()
            .accessibilityIdentifier("detail.servingsValue")

          Button {
            updateServings(by: 1, base: base)
          } label: {
            Image(systemName: "plus")
              .font(.caption.bold())
              .frame(width: 26, height: 26)
          }
          .buttonStyle(.plain)
          .disabled((displayServings ?? base) >= 20)
          .accessibilityLabel("人数を増やす")
          .accessibilityIdentifier("detail.servingsPlus")
        }
        .foregroundStyle(FoodfolioTheme.ink)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .glassEffect(.regular, in: Capsule())
        .accessibilityIdentifier("detail.servingsControl")
      } else {
        Text(raw)
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(FoodfolioTheme.ink)
          .padding(.horizontal, 12)
          .padding(.vertical, 8)
          .glassEffect(.regular, in: Capsule())
          .accessibilityIdentifier("detail.servingsValue")
      }
    }
  }

  private var materialsSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .firstTextBaseline) {
        Text("材料")
          .font(.title2.bold())
          .foregroundStyle(FoodfolioTheme.ink)
        Spacer()
        if let raw = recipe.servingsRaw {
          Text(servingsText(raw: raw))
            .font(.subheadline)
            .foregroundStyle(FoodfolioTheme.secondaryInk)
        }
      }

      VStack(spacing: 0) {
        ForEach(
          Array(recipe.ingredients.sorted(by: { $0.sortOrder < $1.sortOrder }).enumerated()),
          id: \.element.id
        ) { index, ingredient in
          HStack(alignment: .firstTextBaseline, spacing: 16) {
            Text(ingredient.name)
              .foregroundStyle(FoodfolioTheme.ink)
            Spacer(minLength: 16)
            Text(scaledAmount(ingredient.amount) ?? "")
              .foregroundStyle(FoodfolioTheme.secondaryInk)
              .multilineTextAlignment(.trailing)
          }
          .font(.body)
          .padding(.vertical, 12)

          if index < recipe.ingredients.count - 1 {
            Divider().overlay(FoodfolioTheme.hairline)
          }
        }
      }
    }
  }

  private var stepsSection: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("作り方")
        .font(.title2.bold())
        .foregroundStyle(FoodfolioTheme.ink)

      VStack(alignment: .leading, spacing: 20) {
        ForEach(
          Array(recipe.steps.sorted(by: { $0.sortOrder < $1.sortOrder }).enumerated()),
          id: \.element.id
        ) { index, step in
          HStack(alignment: .top, spacing: 14) {
            Text("\(index + 1)")
              .font(.subheadline.bold())
              .foregroundStyle(FoodfolioTheme.terracotta)
              .frame(width: 32, height: 32)
              .background(FoodfolioTheme.terracotta.opacity(0.13), in: Circle())

            Text(step.text)
              .font(.body)
              .foregroundStyle(FoodfolioTheme.ink)
              .fixedSize(horizontal: false, vertical: true)
              .padding(.top, 4)
          }
        }
      }
    }
  }

  private var sourceSection: some View {
    VStack(spacing: 14) {
      Divider().overlay(FoodfolioTheme.hairline)

      Link(destination: URL(string: recipe.originalUrl)!) {
        Label("元レシピを見る", systemImage: "safari")
          .font(.body.weight(.semibold))
          .foregroundStyle(FoodfolioTheme.ink)
          .frame(maxWidth: .infinity, minHeight: 50)
          .glassEffect(
            .regular.interactive(), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
      }
      .accessibilityIdentifier("detail.source")
    }
  }

  private func tagBackground(index: Int) -> Color {
    switch index % 3 {
    case 0: FoodfolioTheme.sage.opacity(0.18)
    case 1: FoodfolioTheme.butter.opacity(0.22)
    default: FoodfolioTheme.terracotta.opacity(0.14)
    }
  }

  private func updateServings(by delta: Double, base: Double) {
    let current = displayServings ?? base
    displayServings = min(20, max(1, current + delta))
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

  var body: some View {
    NavigationStack {
      ZStack {
        FoodfolioBackground()
        List {
          Section("既存タグ") {
            ForEach(tags.filter { tag in !recipe.tags.contains(where: { $0.id == tag.id }) }) {
              tag in
              Button(tag.name) { attach(tag.id) }
            }
          }
          Section("新しいタグ") {
            TextField("タグ名", text: $name).accessibilityIdentifier("tag.name")
            Button("追加") { createAndAttach() }
              .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
              .accessibilityIdentifier("tag.create")
          }
          if let error { Text(error).foregroundStyle(.red) }
        }
        .scrollContentBackground(.hidden)
      }
      .tint(FoodfolioTheme.terracotta)
      .navigationTitle("タグを追加")
      .toolbar { Button("閉じる") { dismiss() } }
      .onAppear { tags = (try? session.repository.allTags()) ?? [] }
    }
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
    Task {
      do {
        let tag = try await session.repository.createTag(name: name)
        _ = try await session.repository.attach(tagID: tag.id, recipeID: recipe.id)
        dismiss()
      } catch { self.error = error.localizedDescription }
    }
  }
}
