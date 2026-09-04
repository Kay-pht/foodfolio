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
      let heroHeight = min(max(geometry.size.width * 0.82, 300), 360)

      ScrollView {
        VStack(spacing: 0) {
          RecipeImageView(recipe: recipe)
            .frame(width: geometry.size.width, height: heroHeight)
            .clipped()
            .accessibilityIdentifier("detail.heroImage")

          VStack(alignment: .leading, spacing: 24) {
            summarySection

            if RecipeDetailPresentation.showsAnalysisFailure(for: recipe.analysisStatus) {
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
      .onScrollGeometryChange(for: Bool.self) { scrollGeometry in
        scrollGeometry.contentOffset.y > heroHeight
      } action: { _, shouldShowCompactTitle in
        withAnimation(.easeInOut(duration: 0.2)) {
          showsCompactTitle = shouldShowCompactTitle
        }
      }
      .background(FoodfolioTheme.paper)
    }
    .ignoresSafeArea(edges: .top)
    .navigationTitle("")
    .navigationBarTitleDisplayMode(.inline)
    .tint(FoodfolioTheme.terracotta)
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
        if RecipeDetailPresentation.canEdit(status: recipe.analysisStatus) {
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
      if let genre = recipe.genre {
        Text(genre.rawValue)
          .font(.caption.weight(.semibold))
          .foregroundStyle(genre.badgeTint)
          .padding(.horizontal, 10)
          .padding(.vertical, 6)
          .background(genre.badgeTint.opacity(0.14), in: Capsule())
          .accessibilityIdentifier("detail.genreBadge")
      }

      Text(recipe.title)
        .font(.largeTitle.bold())
        .foregroundStyle(FoodfolioTheme.ink)
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("detail.title")

      HStack(spacing: 10) {
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
    switch RecipeDetailPresentation.servingsControl(
      raw: recipe.servingsRaw, base: recipe.servingsValue, displayed: displayServings
    ) {
    case .hidden:
      EmptyView()
    case .fixed(let text):
      Text(text)
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(FoodfolioTheme.ink)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .glassEffect(.regular, in: Capsule())
        .accessibilityIdentifier("detail.servingsValue")
    case .adjustable(let text, let canDecrease, let canIncrease):
      if let base = recipe.servingsValue {
        HStack(spacing: 0) {
          Button {
            updateServings(by: -1, base: base)
          } label: {
            Image(systemName: "minus")
              .font(.caption.bold())
              .frame(width: 44, height: 44)
              .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .disabled(!canDecrease)
          .accessibilityLabel("人数を減らす")
          .accessibilityIdentifier("detail.servingsMinus")

          Text(text)
            .font(.subheadline.weight(.semibold))
            .monospacedDigit()
            .accessibilityIdentifier("detail.servingsValue")

          Button {
            updateServings(by: 1, base: base)
          } label: {
            Image(systemName: "plus")
              .font(.caption.bold())
              .frame(width: 44, height: 44)
              .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .disabled(!canIncrease)
          .accessibilityLabel("人数を増やす")
          .accessibilityIdentifier("detail.servingsPlus")
        }
        .foregroundStyle(FoodfolioTheme.ink)
        .padding(.horizontal, 4)
        .glassEffect(.regular, in: Capsule())
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
            .accessibilityIdentifier("detail.materialsServingsValue")
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
    displayServings = RecipeDetailPresentation.updatedServings(
      current: displayServings, base: base, delta: delta)
  }

  private func servingsText(raw: String) -> String {
    ServingDisplayFormatter.text(value: displayServings ?? recipe.servingsValue, raw: raw)
  }

  private func scaledAmount(_ amount: String?) -> String? {
    RecipeDetailPresentation.scaledAmount(
      amount, base: recipe.servingsValue, displayed: displayServings)
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
  @State private var selectedTagIDs: Set<String> = []
  @State private var pendingNewTagNames: [String] = []
  @State private var createdPendingTagIDs: [String: String] = [:]
  @State private var error: String?
  @State private var isSaving = false

  private var availableTags: [LocalTag] {
    tags
      .filter { tag in !recipe.tags.contains(where: { $0.id == tag.id }) }
      .sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
  }

  private var trimmedName: String {
    name.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private var hasChanges: Bool {
    !selectedTagIDs.isEmpty || !pendingNewTagNames.isEmpty
  }

  var body: some View {
    NavigationStack {
      ZStack {
        FoodfolioBackground()

        ScrollView {
          VStack(alignment: .leading, spacing: 28) {
            existingTagsSection
            newTagSection

            if !pendingNewTagNames.isEmpty {
              pendingTagsSection
            }

            if let error {
              Label(error, systemImage: "exclamationmark.circle")
                .font(.subheadline)
                .foregroundStyle(.red)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("tag.error")
            }
          }
          .padding(.horizontal, 20)
          .padding(.vertical, 20)
        }
        .scrollIndicators(.hidden)
      }
      .tint(FoodfolioTheme.terracotta)
      .navigationTitle("タグを追加")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button {
            dismiss()
          } label: {
            Image(systemName: "xmark")
          }
          .accessibilityLabel("閉じる")
          .accessibilityIdentifier("tag.cancel")
        }

        if hasChanges {
          ToolbarItem(placement: .confirmationAction) {
            Button {
              saveChanges()
            } label: {
              if isSaving {
                ProgressView()
              } else {
                Image(systemName: "checkmark")
              }
            }
            .tint(.blue)
            .disabled(isSaving)
            .accessibilityLabel("タグを保存")
            .accessibilityIdentifier("tag.save")
          }
        }
      }
      .onAppear { tags = (try? session.repository.allTags()) ?? [] }
    }
  }

  private var existingTagsSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("既存タグ")
        .font(.headline)
        .foregroundStyle(FoodfolioTheme.secondaryInk)

      if availableTags.isEmpty {
        Text("追加できる既存タグはありません")
          .font(.subheadline)
          .foregroundStyle(FoodfolioTheme.secondaryInk)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(16)
          .glassEffect(
            .regular, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
      } else {
        VStack(spacing: 0) {
          ForEach(Array(availableTags.enumerated()), id: \.element.id) { index, tag in
            Button {
              toggle(tag.id)
            } label: {
              HStack(spacing: 12) {
                Text(tag.name)
                  .foregroundStyle(FoodfolioTheme.ink)
                Spacer(minLength: 12)
                Image(
                  systemName: selectedTagIDs.contains(tag.id)
                    ? "checkmark.circle.fill" : "circle"
                )
                .foregroundStyle(
                  selectedTagIDs.contains(tag.id) ? Color.blue : FoodfolioTheme.secondaryInk
                )
              }
              .padding(.horizontal, 16)
              .frame(maxWidth: .infinity, minHeight: 52)
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(selectedTagIDs.contains(tag.id) ? "選択中" : "未選択")
            .accessibilityIdentifier("tag.existing.\(tag.id)")

            if index < availableTags.count - 1 {
              Divider().overlay(FoodfolioTheme.hairline)
            }
          }
        }
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
      }
    }
  }

  private var newTagSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("新しいタグ")
        .font(.headline)
        .foregroundStyle(FoodfolioTheme.secondaryInk)

      TextField("タグ名", text: $name)
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity, minHeight: 52)
        .glassEffect(
          .regular,
          in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .submitLabel(.done)
        .onSubmit(queueNewTag)
        .accessibilityIdentifier("tag.name")

      Button {
        queueNewTag()
      } label: {
        Text("タグを追加")
          .font(.body.weight(.semibold))
          .frame(maxWidth: .infinity, minHeight: 50)
      }
      .buttonStyle(.borderedProminent)
      .tint(FoodfolioTheme.terracotta)
      .disabled(trimmedName.isEmpty || isSaving)
      .accessibilityIdentifier("tag.create")
    }
  }

  private var pendingTagsSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("追加予定")
        .font(.headline)
        .foregroundStyle(FoodfolioTheme.secondaryInk)

      VStack(spacing: 0) {
        ForEach(Array(pendingNewTagNames.enumerated()), id: \.element) { index, pendingName in
          HStack(spacing: 12) {
            Text("#\(pendingName)")
              .foregroundStyle(FoodfolioTheme.ink)
              .accessibilityIdentifier("tag.pending.\(pendingName)")
            Spacer(minLength: 12)
            Button {
              pendingNewTagNames.removeAll { $0 == pendingName }
              createdPendingTagIDs[pendingName] = nil
            } label: {
              Image(systemName: "xmark.circle.fill")
                .foregroundStyle(FoodfolioTheme.secondaryInk)
                .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(pendingName) を追加予定から外す")
          }
          .padding(.leading, 16)
          .padding(.trailing, 4)
          .frame(minHeight: 52)

          if index < pendingNewTagNames.count - 1 {
            Divider().overlay(FoodfolioTheme.hairline)
          }
        }
      }
      .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
  }

  private func toggle(_ id: String) {
    error = nil
    if selectedTagIDs.contains(id) {
      selectedTagIDs.remove(id)
    } else {
      selectedTagIDs.insert(id)
    }
  }

  private func queueNewTag() {
    let candidate = trimmedName
    guard !candidate.isEmpty else { return }
    error = nil

    if recipe.tags.contains(where: { sameName($0.name, candidate) }) {
      error = "このタグはすでに付いています。"
      return
    }

    if let existing = availableTags.first(where: { sameName($0.name, candidate) }) {
      selectedTagIDs.insert(existing.id)
      name = ""
      return
    }

    guard !pendingNewTagNames.contains(where: { sameName($0, candidate) }) else {
      error = "同じタグが追加予定に入っています。"
      return
    }

    pendingNewTagNames.append(candidate)
    name = ""
  }

  private func saveChanges() {
    guard hasChanges, !isSaving else { return }
    isSaving = true
    error = nil
    let existingIDs = selectedTagIDs.sorted()
    let newNames = pendingNewTagNames

    Task {
      do {
        for id in existingIDs {
          _ = try await session.repository.attach(tagID: id, recipeID: recipe.id)
          selectedTagIDs.remove(id)
        }

        for pendingName in newNames {
          let tagID: String
          if let createdID = createdPendingTagIDs[pendingName] {
            tagID = createdID
          } else {
            let tag = try await session.repository.createTag(name: pendingName)
            tagID = tag.id
            createdPendingTagIDs[pendingName] = tag.id
          }
          _ = try await session.repository.attach(tagID: tagID, recipeID: recipe.id)
          pendingNewTagNames.removeAll { $0 == pendingName }
          createdPendingTagIDs[pendingName] = nil
        }

        dismiss()
      } catch {
        self.error = error.localizedDescription
        self.isSaving = false
        self.tags = (try? session.repository.allTags()) ?? self.tags
      }
    }
  }

  private func sameName(_ lhs: String, _ rhs: String) -> Bool {
    lhs.localizedCaseInsensitiveCompare(rhs) == .orderedSame
  }
}
