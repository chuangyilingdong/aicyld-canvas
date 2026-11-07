package skills

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"infinite-canvas/backend/internal/kernel"
	"io"
	"os"
	"path"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type skillPackageMetadata struct {
	Name          string
	TechnicalName string
	Description   string
	Version       string
}

func archiveFromMarkdown(data []byte, fallbackName string, fallbackDescription string) (skillPackageArchive, error) {
	return archiveFromMarkdownWithFiles(data, fallbackName, fallbackDescription, nil)
}

func archiveFromMarkdownWithFiles(data []byte, fallbackName string, fallbackDescription string, extraFiles map[string][]byte) (skillPackageArchive, error) {
	if len(data) == 0 || len(data) > maxSkillFileBytes || !utf8.Valid(data) {
		return skillPackageArchive{}, kernel.BadAuthRequest("Markdown 文件为空、过大或不是 UTF-8")
	}
	metadata := parseSkillPackageMetadata(data)
	if metadata.Name == "" {
		metadata.Name = strings.TrimSpace(fallbackName)
	}
	if metadata.Description == "" {
		metadata.Description = strings.TrimSpace(fallbackDescription)
	}
	files := make(map[string][]byte, len(extraFiles)+1)
	for filePath, content := range extraFiles {
		if filePath == "SKILL.md" {
			continue
		}
		files[filePath] = content
	}
	files["SKILL.md"] = data
	return finalizeSkillArchive(files, metadata)
}

func archiveFromZip(data []byte, subdir string) (skillPackageArchive, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return skillPackageArchive{}, kernel.BadAuthRequest("ZIP 文件无法解析")
	}
	if len(reader.File) > maxSkillBundleSourceFiles {
		return skillPackageArchive{}, kernel.BadAuthRequest("压缩包文件数量过多，无法安全导入")
	}
	raw := make(map[string][]byte)
	var total int64
	for _, entry := range reader.File {
		if entry.FileInfo().IsDir() {
			continue
		}
		if entry.Mode()&os.ModeSymlink != 0 || !entry.Mode().IsRegular() {
			return skillPackageArchive{}, kernel.BadAuthRequest("技能包不能包含软链接或特殊文件")
		}
		entryPath, err := normalizeSkillPath(entry.Name)
		if err != nil {
			return skillPackageArchive{}, err
		}
		if strings.HasPrefix(entryPath, "__MACOSX/") || path.Base(entryPath) == ".DS_Store" {
			continue
		}
		if ignoredSkillRepositoryPath(entryPath) {
			continue
		}
		if _, exists := raw[entryPath]; exists {
			return skillPackageArchive{}, kernel.BadAuthRequest("技能包包含重复文件路径")
		}
		if entry.UncompressedSize64 > maxSkillFileBytes {
			return skillPackageArchive{}, kernel.BadAuthRequest("技能包中单个文件不能超过 8MB")
		}
		file, err := entry.Open()
		if err != nil {
			return skillPackageArchive{}, err
		}
		content, readErr := io.ReadAll(io.LimitReader(file, maxSkillFileBytes+1))
		closeErr := file.Close()
		if readErr != nil {
			return skillPackageArchive{}, readErr
		}
		if closeErr != nil {
			return skillPackageArchive{}, closeErr
		}
		if len(content) > maxSkillFileBytes {
			return skillPackageArchive{}, kernel.BadAuthRequest("技能包中单个文件不能超过 8MB")
		}
		total += int64(len(content))
		if total > maxSkillPackageBytes {
			return skillPackageArchive{}, kernel.BadAuthRequest("技能包解压后不能超过 20MB")
		}
		raw[entryPath] = content
	}
	files, err := normalizeSkillArchiveRoot(raw, subdir)
	if err != nil {
		return skillPackageArchive{}, err
	}
	metadata := parseSkillPackageMetadata(files["SKILL.md"])
	return finalizeSkillArchive(files, metadata)
}

func normalizeSkillArchiveRoot(raw map[string][]byte, subdir string) (map[string][]byte, error) {
	if len(raw) == 0 {
		return nil, kernel.BadAuthRequest("技能包为空")
	}
	wrapperName := ""
	paths := sortedSkillPaths(raw)
	firstParts := strings.SplitN(paths[0], "/", 2)
	if len(firstParts) == 2 {
		wrapper := firstParts[0] + "/"
		allWrapped := true
		for _, filePath := range paths {
			if !strings.HasPrefix(filePath, wrapper) {
				allWrapped = false
				break
			}
		}
		if allWrapped {
			wrapperName = strings.TrimSuffix(firstParts[0], "/")
			next := make(map[string][]byte, len(raw))
			for filePath, content := range raw {
				next[strings.TrimPrefix(filePath, wrapper)] = content
			}
			raw = next
		}
	}
	subdir = strings.Trim(strings.ReplaceAll(strings.TrimSpace(subdir), "\\", "/"), "/")
	if subdir != "" {
		normalized, err := normalizeSkillPath(subdir)
		if err != nil {
			return nil, err
		}
		prefix := normalized + "/"
		filtered := make(map[string][]byte)
		for filePath, content := range raw {
			if strings.HasPrefix(filePath, prefix) {
				filtered[strings.TrimPrefix(filePath, prefix)] = content
			}
		}
		if len(filtered) == 0 {
			return nil, kernel.BadAuthRequest("GitHub 子目录不存在或为空")
		}
		raw = filtered
	}
	skillRoots := make([]string, 0, 4)
	for _, filePath := range sortedSkillPaths(raw) {
		if filePath == "SKILL.md" {
			skillRoots = []string{""}
			break
		}
		if path.Base(filePath) == "SKILL.md" {
			skillRoots = append(skillRoots, path.Dir(filePath))
		}
	}
	if len(skillRoots) == 0 {
		return nil, kernel.BadAuthRequest("技能包中缺少 SKILL.md")
	}
	if len(skillRoots) > 1 {
		return bundleSkillArchiveFiles(raw, skillRoots, wrapperName)
	}
	root := skillRoots[0]
	files := make(map[string][]byte)
	for filePath, content := range raw {
		if root != "" {
			prefix := root + "/"
			if !strings.HasPrefix(filePath, prefix) {
				continue
			}
			filePath = strings.TrimPrefix(filePath, prefix)
		}
		files[filePath] = content
	}
	if len(files) > maxSkillPackageFiles {
		return nil, kernel.BadAuthRequest("技能包文件数量不能超过 512 个")
	}
	return files, nil
}

// bundleSkillArchiveFiles keeps a multi-skill repository as one installable
// bundle. The generated root SKILL.md is the router: it lists the member
// skills, and the runtime only loads the member whose description best matches
// the user's task.
func bundleSkillArchiveFiles(raw map[string][]byte, roots []string, wrapperName string) (map[string][]byte, error) {
	selected := make(map[string][]byte)
	for filePath, content := range raw {
		for _, root := range roots {
			if strings.HasPrefix(filePath, root+"/") {
				selected[filePath] = content
				break
			}
		}
	}
	if len(selected)+1 > maxSkillPackageFiles {
		return nil, kernel.BadAuthRequest("技能包内各技能文件合计不能超过 512 个")
	}

	name, description := bundleSkillMetadata(raw, wrapperName)
	if name == "" {
		name = "技能合集"
	}
	if description == "" {
		description = "这是一个包含多个子技能的整体技能包，根据用户任务选择最匹配的子技能。"
	}
	description = fitRunes(description, maxSkillDescriptionRunes)
	name = fitRunes(name, maxSkillNameRunes)

	var body strings.Builder
	body.WriteString("---\nname: ")
	body.WriteString(strconv.Quote(name))
	body.WriteString("\ndescription: ")
	body.WriteString(strconv.Quote(description))
	body.WriteString("\n---\n\n# ")
	body.WriteString(name)
	body.WriteString("\n\n这是一个整体技能包，内部分为 ")
	body.WriteString(strconv.Itoa(len(roots)))
	body.WriteString(" 个可路由的子技能。先根据用户任务选择最匹配的子技能，再只读取该子技能的 `SKILL.md`；不要一次加载全部子技能。\n\n## 子技能路由\n\n")
	for _, root := range roots {
		member := parseSkillPackageMetadata(raw[root+"/SKILL.md"])
		memberName := strings.TrimSpace(member.Name)
		if memberName == "" {
			memberName = path.Base(root)
		}
		memberDescription := strings.Join(strings.Fields(member.Description), " ")
		memberDescription = fitRunes(memberDescription, 180)
		body.WriteString("- `")
		body.WriteString(root)
		body.WriteString("/SKILL.md` — ")
		body.WriteString(memberName)
		if memberDescription != "" {
			body.WriteString("：")
			body.WriteString(memberDescription)
		}
		body.WriteString("\n")
	}
	body.WriteString("\n## 执行规则\n\n")
	body.WriteString("1. 从上面的名称和简介中选出与用户任务最匹配的一个子技能。\n")
	body.WriteString("2. 读取该子技能的 `SKILL.md`，并遵循它的流程和约束。\n")
	body.WriteString("3. 只在子技能明确引用时读取它目录下的参考文件；不要读取其他无关子技能。\n")
	body.WriteString("4. 如果两个子技能都明显相关，先读取覆盖面更完整的那个，再按它的指引加载配套技能。\n")
	body.WriteString("5. 如果确实无法判断，先向用户确认目标，不要凭空选择或伪造执行结果。\n")
	selected["SKILL.md"] = []byte(body.String())
	return selected, nil
}

func bundleSkillMetadata(raw map[string][]byte, wrapperName string) (string, string) {
	for filePath, content := range raw {
		base := path.Base(filePath)
		if base != "plugin.json" || (!strings.Contains(filePath, ".codex-plugin/") && !strings.Contains(filePath, ".claude-plugin/")) {
			continue
		}
		var doc struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			Interface   struct {
				DisplayName string `json:"displayName"`
			} `json:"interface"`
		}
		if json.Unmarshal(content, &doc) != nil {
			continue
		}
		name := strings.TrimSpace(doc.Interface.DisplayName)
		if name == "" {
			name = strings.TrimSpace(doc.Name)
		}
		if name != "" || strings.TrimSpace(doc.Description) != "" {
			return name, strings.TrimSpace(doc.Description)
		}
	}
	name := strings.TrimSpace(wrapperName)
	for _, suffix := range []string{"-main", "_main", ".zip"} {
		name = strings.TrimSuffix(name, suffix)
	}
	name = strings.TrimSpace(strings.NewReplacer("-", " ", "_", " ").Replace(name))
	return name, ""
}

func ignoredSkillRepositoryPath(filePath string) bool {
	for _, part := range strings.Split(filePath, "/") {
		switch part {
		case ".git", "node_modules", "__pycache__", ".cache":
			return true
		}
	}
	return false
}

func finalizeSkillArchive(files map[string][]byte, metadata skillPackageMetadata) (skillPackageArchive, error) {
	if _, ok := files["SKILL.md"]; !ok {
		return skillPackageArchive{}, kernel.BadAuthRequest("技能包入口必须是 SKILL.md")
	}
	if metadata.Name == "" {
		return skillPackageArchive{}, kernel.BadAuthRequest("SKILL.md 缺少 name，且无法从标题推断")
	}
	if metadata.Description == "" {
		return skillPackageArchive{}, kernel.BadAuthRequest("SKILL.md 缺少 description，且无法从正文推断")
	}
	if utf8.RuneCountInString(metadata.Name) > maxSkillNameRunes || utf8.RuneCountInString(metadata.Description) > maxSkillDescriptionRunes {
		return skillPackageArchive{}, kernel.BadAuthRequest("技能名称或简介超过长度限制")
	}
	hash := sha256.New()
	var total int64
	for _, filePath := range sortedSkillPaths(files) {
		content := files[filePath]
		total += int64(len(content))
		if total > maxSkillPackageBytes {
			return skillPackageArchive{}, kernel.BadAuthRequest("技能包解压后不能超过 20MB")
		}
		hash.Write([]byte(filePath))
		hash.Write([]byte{0})
		hash.Write(content)
		hash.Write([]byte{0})
	}
	return skillPackageArchive{Files: files, Metadata: metadata, ContentHash: hex.EncodeToString(hash.Sum(nil)), TotalBytes: total}, nil
}

func encodeSkillArchive(files map[string][]byte) ([]byte, error) {
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, filePath := range sortedSkillPaths(files) {
		header := &zip.FileHeader{Name: filePath, Method: zip.Deflate}
		header.SetMode(0o600)
		header.SetModTime(time.Date(1980, 1, 1, 0, 0, 0, 0, time.UTC))
		entry, err := writer.CreateHeader(header)
		if err != nil {
			return nil, err
		}
		if _, err := entry.Write(files[filePath]); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func parseSkillPackageMetadata(data []byte) skillPackageMetadata {
	text := string(data)
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	metadata := skillPackageMetadata{}
	bodyStart := 0
	if len(lines) > 2 && strings.TrimSpace(lines[0]) == "---" {
		metadataIndent := -1
		for index := 1; index < len(lines); index++ {
			line := lines[index]
			if strings.TrimSpace(line) == "---" {
				bodyStart = index + 1
				break
			}
			trimmed := strings.TrimSpace(line)
			indent := len(line) - len(strings.TrimLeft(line, " \t"))
			if indent == 0 {
				metadataIndent = -1
			}
			key, value, ok := strings.Cut(trimmed, ":")
			if !ok {
				continue
			}
			key = strings.TrimSpace(key)
			value = yamlScalar(value)
			switch {
			case indent == 0 && key == "name":
				metadata.Name = value
			case indent == 0 && key == "description":
				metadata.Description = value
			case indent == 0 && key == "version":
				metadata.Version = value
			case indent == 0 && key == "metadata":
				metadataIndent = indent
			case metadataIndent >= 0 && indent > metadataIndent && key == "version":
				metadata.Version = value
			}
		}
	}
	body := lines[bodyStart:]
	metadata.TechnicalName, metadata.Name = metadata.Name, displaySkillName(metadata.Name, body)
	if metadata.Name == "" {
		metadata.Name = firstMarkdownTitle(body)
	}
	if metadata.Description == "" {
		paragraph := make([]string, 0, 4)
		for _, line := range body {
			trimmed := strings.TrimSpace(line)
			if trimmed == "" {
				if len(paragraph) > 0 {
					break
				}
				continue
			}
			if strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "```") {
				continue
			}
			paragraph = append(paragraph, trimmed)
		}
		metadata.Description = strings.Join(paragraph, " ")
	}
	metadata.Name = fitRunes(strings.TrimSpace(metadata.Name), maxSkillNameRunes)
	metadata.Description = fitRunes(strings.TrimSpace(metadata.Description), maxSkillDescriptionRunes)
	metadata.Version = kernel.TruncateRunes(strings.TrimSpace(metadata.Version), 64)
	return metadata
}

// fitRunes 把超长文本截到上限以内（省略号也算在内），截完不会再被打包校验判为超长。
func fitRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return strings.TrimSpace(string(runes[:limit-1])) + "…"
}

func yamlScalar(value string) string {
	value = strings.TrimSpace(value)
	if len(value) >= 2 && value[0] == '"' {
		if decoded, err := strconv.Unquote(value); err == nil {
			return strings.TrimSpace(decoded)
		}
	}
	if len(value) >= 2 && value[0] == '\'' && value[len(value)-1] == '\'' {
		return strings.TrimSpace(value[1 : len(value)-1])
	}
	return value
}
