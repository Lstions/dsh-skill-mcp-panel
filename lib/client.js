window.__ModuleLoader__.load({
	id: "dsh-skill-mcp-panel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		//#region lib/types/client/card.module.css
		/**
		 * Card styles, injected once through a tagged style element with a
		 * querySelector guard — the convention every shipped ui-* plugin uses, so a
		 * reloaded bundle never stacks duplicate sheets.
		 */
		const CSS =
			".skn_card{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px;list-style:none;transition:border-color .16s,background .16s}" +
			".skn_card:hover{border-color:var(--dsw-alias-label-dimmed)}" +
			".skn_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}" +
			".skn_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}" +
			".skn_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}" +
			".skn_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}" +
			".skn_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}" +
			".skn_description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}" +
			".skn_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}" +
			".skn_chevronOpen{transform:rotate(180deg)}" +
			".skn_pending{flex:none;color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l4);border-radius:6px;padding:1px 6px;font-size:11px;line-height:1.6}" +
			".skn_body{border-top:.5px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}" +
			".skn_readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}" +
			".skn_footer{border-top:.5px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}" +
			".skn_failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}" +
			".skn_field{flex-direction:column;gap:6px;padding:12px 0;display:flex}" +
			".skn_field+.skn_field{border-top:.5px solid var(--dsw-alias-border-l2)}" +
			".skn_head{align-items:center;gap:8px;display:flex}" +
			".skn_label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}" +
			".skn_badges{align-items:center;gap:8px;display:inline-flex}" +
			".skn_badge{color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l4);border-radius:6px;padding:1px 6px;font-size:11px;line-height:1.6}" +
			".skn_reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}" +
			".skn_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}" +
			".skn_reset:disabled{cursor:default}" +
			".skn_input{box-sizing:border-box;width:100%;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}" +
			".skn_input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}" +
			".skn_input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}" +
			".skn_inputInvalid{border-color:var(--dsw-alias-label-error)}" +
			".skn_textarea{height:auto;min-height:78px;resize:vertical;padding:8px 12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}" +
			".skn_invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}" +
			".skn_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}" +
			".skn_note{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;line-height:1.5;padding:0 0 4px}" +
			".skn_select{appearance:auto;cursor:pointer}" +
			".skn_checkRow{align-items:center;gap:8px;display:flex}" +
			".skn_checkbox{width:16px;height:16px;flex:none;margin:0;accent-color:var(--dsw-alias-brand-primary)}" +
			".skn_button{height:32px;font:inherit;font-size:13px;cursor:pointer;border-radius:8px;padding:0 14px;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}" +
			".skn_button:disabled{cursor:default;color:var(--dsw-alias-label-tertiary)}" +
			".skn_primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}" +
			".skn_primary:disabled{background:var(--dsw-alias-bg-layer-3);border-color:var(--dsw-alias-border-l4)}" +
			// ── management page ──────────────────────────────────────────────
			".skn_page{flex-direction:column;gap:12px;display:flex;padding:4px 0 24px}" +
			".skn_pageHead{border-bottom:.5px solid var(--dsw-alias-border-l1);flex-direction:column;gap:4px;padding-bottom:12px;display:flex}" +
			".skn_pageTitle{color:var(--dsw-alias-label-primary);margin:0;font-size:15px;font-weight:600;line-height:22px}" +
			".skn_section{color:var(--dsw-alias-label-primary);margin:8px 0 0;font-size:14px;font-weight:600;line-height:20px}" +
			".skn_muted{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:18px;margin:0}" +
			".skn_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:17px}" +
			".skn_error{color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:18px;margin:0}" +
			".skn_errors{color:var(--dsw-alias-state-error-primary);margin:0;padding-left:18px;font-size:12px;line-height:18px}" +
			".skn_notice{border-radius:8px;align-self:flex-start;padding:4px 10px;font-size:13px;line-height:18px;margin:0}" +
			".skn_filters{align-items:center;gap:8px;flex-wrap:wrap;display:flex}" +
			".skn_input{height:32px;font:inherit;font-size:13px;border-radius:8px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);min-width:160px}" +
			".skn_groups,.skn_rows,.skn_conflicts,.skn_servers{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}" +
			".skn_group{border:.5px solid var(--dsw-alias-border-l4);border-radius:12px;overflow:hidden}" +
			".skn_groupHead{appearance:none;width:100%;font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);text-align:left;cursor:pointer;background:var(--dsw-alias-bg-layer-3);border:0;border-radius:0;justify-content:space-between;gap:12px;padding:8px 12px;display:flex}" +
			".skn_groupHead:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}" +
			".skn_groupHead:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}" +
			".skn_row{border-top:.5px solid var(--dsw-alias-border-l1);align-items:flex-start;gap:12px;padding:8px 12px;display:flex}" +
			".skn_rowMain{flex-direction:column;gap:2px;flex:1;min-width:0;display:flex}" +
			".skn_rowToggle{appearance:none;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:6px;align-items:center;gap:8px;padding:0;display:flex}" +
			".skn_rowToggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}" +
			".skn_rowName{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:18px}" +
			".skn_rowDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px;overflow-wrap:anywhere}" +
			".skn_badge{border-radius:999px;flex:none;padding:1px 8px;font-size:11px;line-height:16px}" +
			".skn_badge-on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}" +
			".skn_badge-off{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary)}" +
			".skn_badge-ok{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-success-primary)}" +
			".skn_badge-warn{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-warning-primary)}" +
			".skn_badge-bad{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary)}" +
			".skn_badge-muted{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary)}" +
			".skn_switch{width:16px;height:16px;flex:none;margin:2px 0 0;accent-color:var(--dsw-alias-brand-primary)}" +
			".skn_facts{grid-template-columns:minmax(88px,auto) 1fr;gap:2px 12px;margin:4px 0 0;display:grid}" +
			".skn_facts dt{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px}" +
			".skn_facts dd{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;line-height:17px;overflow-wrap:anywhere;white-space:pre-wrap}" +
			".skn_conflict,.skn_server{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:12px;flex-direction:column;gap:4px;padding:10px 12px;display:flex}" +
			".skn_conflictRow{align-items:baseline;gap:8px;flex-wrap:wrap;display:flex}" +
			".skn_conflictRow code,.skn_server code{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-markdown-code-block-small);overflow-wrap:anywhere}";

		const CSS_TAG_ID = "dsh-skill-mcp-panel/SkillNestingCard.module.css";
		if (
			typeof document !== "undefined" &&
			document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG_ID) + "]") === null
		) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-skill-mcp-panel";
			tag.dataset.pluginCss = CSS_TAG_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region lib/types/client/locales.js
		/** Dictionary namespace owned by this plugin. */
		const NS = "skill-mcp-panel";

		/** English copy. */
		const en = {
			title: "Skill nesting",
			description: "Recursive, multi-root skill discovery.",
			intro:
				"The built-in provider reads each root one level deep, so skills organised as <root>/<category>/<skill>/SKILL.md stay invisible. This provider walks each root to the configured depth and adds those skills to the same catalog.",
			expand: "Expand settings",
			collapse: "Collapse settings",
			unsaved: "Unsaved",
			readOnly: "This deployment's settings are read-only.",
			save: "Save",
			saving: "Saving…",
			discard: "Discard changes",
			saveFailed: "This deployment did not accept these values; your edits are kept.",
			overridden: "Overridden",
			reset: "Reset",
			roots: "Skill roots",
			rootsHint: "Absolute paths, one per line. A root may also hold flat <root>/*.md skills.",
			providerName: "Provider name",
			providerNameHint: "Name this provider registers in the skills registry.",
			maxDepth: "Max depth",
			maxDepthHint: "Category levels to descend below each root.",
			rank: "Rank",
			rankHint: "Precedence within its layer; lower wins. The built-in roots use 400/500.",
			watch: "Watch for changes",
			watchHint: "Recursively watch each root and refresh the catalog on edits.",
			watchDebounceMs: "Watch debounce (ms)",
			watchDebounceMsHint: "Delay before a filesystem change refreshes the catalog.",
			includeHidden: "Include hidden directories",
			includeHiddenHint: "Descend into dot-directories such as .archive or .system.",
			includeFlatRootFiles: "Include flat root files",
			includeFlatRootFilesHint: "Also read skills written directly as <root>/*.md.",
			duplicatePolicy: "Duplicate policy",
			duplicatePolicyHint: "How one skill name provided by several distinct files is resolved.",
			policyFirstWins: "First wins — keep the first root's file",
			policyError: "Error — withhold the name entirely",
			policyFirstWinsNote:
				"With “First wins”, the first root supplying a name keeps it. Roots that are the same directory (a symlink alias, or a mirrored tree) are recognised by file identity and never count as duplicates.",
			policyErrorNote:
				"With “Error”, a name claimed by two distinct files is withheld entirely, so a caller can never act on the wrong instructions.",
			duplicatePolicyRequired: "Choose a duplicate policy.",
			providerNameRequired: "Enter a provider name.",
			invalidNumber: "Enter a number.",
			invalidDepth: "Enter a whole number from 1 to 12.",
			invalidDebounce: "Enter a whole number of at least 50.",
		};

		/** Simplified Chinese copy. */
		const zh = {
			title: "分层技能发现",
			description: "递归、多根目录的技能发现。",
			intro:
				"内置 provider 每个根目录只读一层，因此 <root>/<分类>/<技能>/SKILL.md 这种布局的技能完全看不到。本 provider 会按配置深度逐层遍历，把这些技能补进同一个目录。",
			expand: "展开设置",
			collapse: "收起设置",
			unsaved: "未保存",
			readOnly: "本部署的设置为只读。",
			save: "保存",
			saving: "保存中…",
			discard: "放弃修改",
			saveFailed: "本部署没有接受这些值，已保留供你修改。",
			overridden: "已覆盖",
			reset: "恢复默认",
			roots: "技能根目录",
			rootsHint: "绝对路径，每行一个。根目录下也可以直接放 <root>/*.md 形式的技能。",
			providerName: "Provider 名称",
			providerNameHint: "该 provider 在技能注册表中注册的名字。",
			maxDepth: "最大深度",
			maxDepthHint: "在每个根目录下向里遍历的分类层数。",
			rank: "优先级",
			rankHint: "同一层内的优先级，数值小者胜出。内置根目录为 400/500。",
			watch: "监听文件变化",
			watchHint: "递归监听各根目录，文件改动后自动刷新技能目录。",
			watchDebounceMs: "监听防抖（毫秒）",
			watchDebounceMsHint: "文件变化后延迟多久刷新技能目录。",
			includeHidden: "包含隐藏目录",
			includeHiddenHint: "是否进入 .archive、.system 这类点号开头的目录。",
			includeFlatRootFiles: "包含根目录下的散装技能",
			includeFlatRootFilesHint: "同时读取直接写成 <root>/*.md 的技能。",
			duplicatePolicy: "重名处理",
			duplicatePolicyHint: "同一个技能名出现在多个不同文件时如何处理。",
			policyFirstWins: "先到先得——保留第一个根目录的文件",
			policyError: "报错——该名字整个撤下",
			policyFirstWinsNote:
				"选择「先到先得」时，先提供该名字的根目录胜出。指向同一目录的多个根（符号链接别名、镜像目录）按文件身份识别，永远不会被算作重名。",
			policyErrorNote:
				"选择「报错」时，被两个不同文件抢用的名字会整个从目录中撤下，调用方绝不会读到错的那份。",
			duplicatePolicyRequired: "请选择一种重名处理方式。",
			providerNameRequired: "请填写 provider 名称。",
			invalidNumber: "请填数字。",
			invalidDepth: "请填 1 到 12 之间的整数。",
			invalidDebounce: "请填不小于 50 的整数。",
		};
		//#endregion

		//#region lib/types/client/fields.js
		/** Chevron affordance for the card header. */
		function Chevron(props) {
			return react.createElement(
				"svg",
				{
					className: props.open ? "skn_chevron skn_chevronOpen" : "skn_chevron",
					width: 14,
					height: 14,
					viewBox: "0 0 16 16",
					fill: "none",
					"aria-hidden": "true",
				},
				react.createElement("path", {
					d: "M4 6.5 8 10.5l4-4",
					stroke: "currentColor",
					strokeWidth: 1.5,
					strokeLinecap: "round",
					strokeLinejoin: "round",
				}),
			);
		}

		/**
		 * One labelled control row: label, optional “overridden” badge with its reset
		 * affordance, the control itself, and a hint that becomes the validation
		 * message while the draft is invalid.
		 */
		function Field(props) {
			return react.createElement(
				"div",
				{ className: "skn_field" },
				react.createElement(
					"div",
					{ className: "skn_head" },
					react.createElement("label", { className: "skn_label", htmlFor: props.id }, props.label),
					props.overridden
						? react.createElement(
								"span",
								{ className: "skn_badges" },
								react.createElement("span", { className: "skn_badge" }, props.overriddenLabel),
								react.createElement(
									"button",
									{ type: "button", className: "skn_reset", disabled: props.disabled, onClick: props.onReset },
									props.resetLabel,
								),
							)
						: null,
				),
				props.control,
				react.createElement(
					"p",
					{ className: props.invalid ? "skn_invalid" : "skn_hint" },
					props.invalid ? props.invalidLabel : props.hint,
				),
			);
		}
		//#endregion

		//#region lib/types/client/form.js
		const NUMBER_FIELDS = [
			{ key: "maxDepth", labelKey: "maxDepth", hintKey: "maxDepthHint", invalidKey: "invalidDepth", min: 1, max: 12 },
			{ key: "rank", labelKey: "rank", hintKey: "rankHint", invalidKey: "invalidNumber" },
			{ key: "watchDebounceMs", labelKey: "watchDebounceMs", hintKey: "watchDebounceMsHint", invalidKey: "invalidDebounce", min: 50 },
		];
		const BOOLEAN_FIELDS = [
			{ key: "watch", labelKey: "watch", hintKey: "watchHint" },
			{ key: "includeHidden", labelKey: "includeHidden", hintKey: "includeHiddenHint" },
			{ key: "includeFlatRootFiles", labelKey: "includeFlatRootFiles", hintKey: "includeFlatRootFilesHint" },
		];
		const POLICY_KEY = "duplicatePolicy";
		const POLICY_OPTIONS = [
			{ value: "first-wins", labelKey: "policyFirstWins" },
			{ value: "error", labelKey: "policyError" },
		];
		const PROVIDER_KEY = "providerName";
		const SECTION_KEYS = [
			"roots",
			POLICY_KEY,
			PROVIDER_KEY,
			...NUMBER_FIELDS.map((field) => field.key),
			...BOOLEAN_FIELDS.map((field) => field.key),
		];
		const BOOLEAN_KEYS = new Set(BOOLEAN_FIELDS.map((field) => field.key));

		/** `roots` accepts an array or one string; normalise either to textarea lines. */
		function rootsToText(roots) {
			if (Array.isArray(roots)) return roots.join("\n");
			if (typeof roots === "string") {
				return roots.split(/[\n,]/).map((part) => part.trim()).filter(Boolean).join("\n");
			}
			return "";
		}

		/** Textarea text to the array the namespace stores. */
		function textToRoots(text) {
			if (typeof text !== "string") return [];
			return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
		}

		/** Every section value with `roots` normalised, so comparison is stable. */
		function normaliseSection(value) {
			return { ...value, roots: textToRoots(rootsToText(value.roots)) };
		}

		/** Structural comparison; these values are small and plain. */
		function same(left, right) {
			return JSON.stringify(left) === JSON.stringify(right);
		}

		/** Parse one numeric control; undefined when the text is not acceptable. */
		function parseNumber(spec, text) {
			const trimmed = String(text).trim();
			if (trimmed === "") return undefined;
			const parsed = Number(trimmed);
			if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return undefined;
			if (spec.min !== undefined && parsed < spec.min) return undefined;
			if (spec.max !== undefined && parsed > spec.max) return undefined;
			return parsed;
		}

		/** Minimal snapshot store, the read shape a card's selector expects. */
		function createStore(initial) {
			let current = initial;
			const listeners = new Set();
			return {
				getSnapshot: () => current,
				subscribe(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				set(next) {
					current = next;
					for (const listener of listeners) listener();
				},
			};
		}

		/**
		 * Staged edits over one bound settings scope.
		 *
		 * A draft is text, because that is what the control holds; `plan()` converts
		 * drafts into the atomic op list a save sends. Only fields whose draft
		 * differs from the resolved value produce an op, so a value the user never
		 * touched cannot be cleared by a save.
		 */
		class CardForm {
			constructor(scope) {
				this.scope = scope;
				/** key -> { text, clear } for edited fields only. */
				this.staged = new Map();
				this.listeners = new Set();
				this.saving = false;
				this.failed = false;
				this.disposed = false;
				this.unsubscribe = scope.subscribe(() => this.publish());
			}

			/**
			 * Stop publishing once the owning fiber unwinds.
			 *
			 * The scope's own subscription belongs to the scope, but this form must
			 * not keep pushing into a card that no longer exists.
			 */
			dispose() {
				if (this.disposed) return;
				this.disposed = true;
				this.unsubscribe?.();
				this.unsubscribe = undefined;
				this.listeners.clear();
			}

			/** Build the store a card reads through its bound selector. */
			bind(project) {
				const store = createStore(project());
				this.listeners.add(() => store.set(project()));
				return store;
			}

			publish() {
				if (this.disposed) return;
				for (const listener of this.listeners) listener();
			}

			/** The resolved section, normalised, or undefined while unavailable. */
			section() {
				const snapshot = this.scope.getSnapshot();
				return snapshot.value === undefined ? undefined : normaliseSection(snapshot.value);
			}

			/** The raw user layer, which is what “overridden” is read from. */
			user() {
				return this.scope.getSnapshot().user;
			}

			/** Card-level state every control shares. */
			shell() {
				const snapshot = this.scope.getSnapshot();
				const plan = this.plan();
				return {
					available: snapshot.status === "ready",
					writable: snapshot.writable === true,
					dirty: plan !== undefined && plan.length > 0,
					invalid: plan === undefined,
					saving: this.saving,
					failed: this.failed,
				};
			}

			/** The text one control shows. */
			text(key) {
				const staged = this.staged.get(key);
				if (staged !== undefined) return staged.text;
				const section = this.section();
				if (section === undefined) return "";
				if (key === "roots") return rootsToText(section.roots);
				const value = section[key];
				return value === undefined || value === null ? "" : String(value);
			}

			/** Whether this field currently carries a user override. */
			overridden(key) {
				const staged = this.staged.get(key);
				if (staged !== undefined) return staged.clear !== true;
				const user = this.user();
				return user !== undefined && user !== null && Object.hasOwn(user, key);
			}

			/** Validation message key for one field, or undefined while it is valid. */
			invalid(key) {
				const staged = this.staged.get(key);
				if (staged === undefined || staged.clear === true) return undefined;
				if (key === "roots") return undefined;
				if (key === PROVIDER_KEY) return staged.text.trim() === "" ? "providerNameRequired" : undefined;
				if (key === POLICY_KEY) {
					return POLICY_OPTIONS.some((option) => option.value === staged.text) ? undefined : "duplicatePolicyRequired";
				}
				const spec = NUMBER_FIELDS.find((field) => field.key === key);
				if (spec === undefined) return undefined;
				return parseNumber(spec, staged.text) === undefined ? spec.invalidKey : undefined;
			}

			/**
			 * The atomic op list this form would write, or undefined when any draft is
			 * invalid. An empty array means “nothing to do”.
			 */
			plan() {
				const section = this.section();
				const ops = [];
				for (const key of SECTION_KEYS) {
					const staged = this.staged.get(key);
					if (staged === undefined) continue;
					if (staged.clear === true) {
						if (section !== undefined) ops.push({ op: "unset", path: [key] });
						continue;
					}
					let value;
					if (key === "roots") {
						value = textToRoots(staged.text);
					} else if (key === PROVIDER_KEY) {
						if (staged.text.trim() === "") return undefined;
						value = staged.text.trim();
					} else if (key === POLICY_KEY) {
						if (!POLICY_OPTIONS.some((option) => option.value === staged.text)) return undefined;
						value = staged.text;
					} else if (BOOLEAN_KEYS.has(key)) {
						value = staged.text === "true";
					} else {
						const spec = NUMBER_FIELDS.find((field) => field.key === key);
						value = parseNumber(spec, staged.text);
						if (value === undefined) return undefined;
					}
					if (section !== undefined && same(value, section[key])) continue;
					ops.push({ op: "set", path: [key], value });
				}
				return ops;
			}

			/** Bind the edit, reset, save, and discard actions to this form. */
			actions() {
				return {
					edit: (key, text) => {
						this.failed = false;
						this.staged.set(key, { text, clear: false });
						this.publish();
					},
					resetField: (key) => {
						this.failed = false;
						this.staged.set(key, { text: "", clear: true });
						this.publish();
					},
					save: () => this.save(),
					discard: () => {
						if (this.staged.size === 0 && !this.failed) return;
						this.staged.clear();
						this.failed = false;
						this.publish();
					},
				};
			}

			/** Write every staged edit as one revision-fenced mutation. */
			async save() {
				const plan = this.plan();
				if (plan === undefined || plan.length === 0) return;
				this.saving = true;
				this.failed = false;
				this.publish();
				try {
					await this.scope.mutate(plan);
					this.staged.clear();
				} catch {
					this.failed = true;
				} finally {
					this.saving = false;
					this.publish();
				}
			}
		}
		//#endregion

		//#region lib/types/client/SkillNestingCard.js
		/**
		 * One plugin's card: a header naming the plugin and what its settings govern,
		 * disclosing the controls in place, with the save that writes them.
		 *
		 * The card owns its chrome and returns an `<li>`, because the Plugins page
		 * renders every card into a `<ul>` and supplies nothing but the slot.
		 */
		function SkillNestingCard(props) {
			const { t, form, store } = props;
			const snapshot = react.useSyncExternalStore(
				react.useCallback((listener) => store.subscribe(listener), [store]),
				react.useCallback(() => store.getSnapshot(), [store]),
				react.useCallback(() => store.getSnapshot(), [store]),
			);
			const [open, setOpen] = react.useState(false);
			const saveStarted = react.useRef(false);

			// Collapse once a save settles cleanly, matching every shipped card.
			react.useEffect(() => {
				if (snapshot.saving) {
					saveStarted.current = true;
					return;
				}
				if (!saveStarted.current) return;
				saveStarted.current = false;
				if (!snapshot.dirty && !snapshot.failed) setOpen(false);
			}, [snapshot.dirty, snapshot.failed, snapshot.saving]);

			// A namespace this Host does not serve renders nothing at all, so an
			// uncomposed plugin leaves no trace on the page.
			if (!snapshot.available) return null;

			const disabled = !snapshot.writable || snapshot.saving;
			const actions = form.actions();

			const fieldProps = (key, labelKey, hintKey) => {
				const invalid = form.invalid(key);
				return {
					id: "skill-mcp-panel-" + key,
					label: t(labelKey),
					hint: t(hintKey),
					disabled,
					overridden: form.overridden(key),
					overriddenLabel: t("overridden"),
					resetLabel: t("reset"),
					onReset: () => actions.resetField(key),
					invalid: invalid !== undefined,
					invalidLabel: invalid === undefined ? "" : t(invalid),
				};
			};

			const numberControl = (spec) => {
				const invalid = form.invalid(spec.key);
				return react.createElement("input", {
					id: "skill-mcp-panel-" + spec.key,
					className: invalid !== undefined ? "skn_input skn_inputInvalid" : "skn_input",
					type: "text",
					inputMode: "numeric",
					value: form.text(spec.key),
					disabled,
					"aria-invalid": invalid !== undefined ? true : undefined,
					onChange: (event) => actions.edit(spec.key, event.target.value),
				});
			};

			return react.createElement(
				"li",
				{ className: open ? "skn_card skn_cardOpen" : "skn_card" },
				react.createElement(
					"button",
					{
						type: "button",
						className: "skn_header",
						"aria-expanded": open,
						"aria-label": t(open ? "collapse" : "expand") + ": " + t("title"),
						onClick: () => setOpen(!open),
					},
					react.createElement(
						"span",
						{ className: "skn_headText" },
						react.createElement("span", { className: "skn_name" }, t("title")),
						react.createElement("span", { className: "skn_description" }, t("description")),
					),
					snapshot.dirty ? react.createElement("span", { className: "skn_pending" }, t("unsaved")) : null,
					react.createElement(Chevron, { open: open }),
				),
				open
					? react.createElement(
							"div",
							{ className: "skn_body" },
							!snapshot.writable
								? react.createElement("p", { className: "skn_readOnly", role: "status" }, t("readOnly"))
								: null,
							react.createElement("p", { className: "skn_note" }, t("intro")),

							react.createElement(Field, {
								...fieldProps("roots", "roots", "rootsHint"),
								control: react.createElement("textarea", {
									id: "skill-mcp-panel-roots",
									className: "skn_input skn_textarea",
									value: form.text("roots"),
									disabled,
									spellCheck: false,
									onChange: (event) => actions.edit("roots", event.target.value),
								}),
							}),

							react.createElement(Field, {
								...fieldProps(POLICY_KEY, "duplicatePolicy", "duplicatePolicyHint"),
								control: react.createElement(
									"select",
									{
										id: "skill-mcp-panel-duplicatePolicy",
										className: "skn_input skn_select",
										value: form.text(POLICY_KEY),
										disabled,
										onChange: (event) => actions.edit(POLICY_KEY, event.target.value),
									},
									POLICY_OPTIONS.map((option) =>
										react.createElement("option", { key: option.value, value: option.value }, t(option.labelKey)),
									),
								),
							}),
							react.createElement(
								"p",
								{ className: "skn_note" },
								form.text(POLICY_KEY) === "error" ? t("policyErrorNote") : t("policyFirstWinsNote"),
							),

							react.createElement(Field, {
								...fieldProps(PROVIDER_KEY, "providerName", "providerNameHint"),
								control: react.createElement("input", {
									id: "skill-mcp-panel-providerName",
									className:
										form.invalid(PROVIDER_KEY) !== undefined ? "skn_input skn_inputInvalid" : "skn_input",
									type: "text",
									value: form.text(PROVIDER_KEY),
									disabled,
									"aria-invalid": form.invalid(PROVIDER_KEY) !== undefined ? true : undefined,
									onChange: (event) => actions.edit(PROVIDER_KEY, event.target.value),
								}),
							}),

							NUMBER_FIELDS.map((spec) =>
								react.createElement(Field, {
									key: spec.key,
									...fieldProps(spec.key, spec.labelKey, spec.hintKey),
									control: numberControl(spec),
								}),
							),

							BOOLEAN_FIELDS.map((field) =>
								react.createElement(Field, {
									key: field.key,
									...fieldProps(field.key, field.labelKey, field.hintKey),
									control: react.createElement(
										"span",
										{ className: "skn_checkRow" },
										react.createElement("input", {
											id: "skill-mcp-panel-" + field.key,
											className: "skn_checkbox",
											type: "checkbox",
											checked: form.text(field.key) === "true",
											disabled,
											onChange: (event) => actions.edit(field.key, event.target.checked ? "true" : "false"),
										}),
									),
								}),
							),

							react.createElement(
								"div",
								{ className: "skn_footer" },
								snapshot.failed
									? react.createElement("p", { className: "skn_failed", role: "status" }, t("saveFailed"))
									: null,
								react.createElement(
									"button",
									{
										type: "button",
										className: "skn_button",
										disabled: !snapshot.dirty || snapshot.saving,
										onClick: () => actions.discard(),
									},
									t("discard"),
								),
								react.createElement(
									"button",
									{
										type: "button",
										className: "skn_button skn_primary",
										disabled: !snapshot.writable || !snapshot.dirty || snapshot.invalid || snapshot.saving,
										onClick: () => actions.save(),
									},
									t(snapshot.saving ? "saving" : "save"),
								),
							),
						)
					: null,
			);
		}
		//#endregion

/**
 * Management-page copy. Generated from docs/copy-zh-en.md and asserted equal in
 * key set by test/ui-page.mjs — the two dictionaries must never drift apart.
 */
const UI_EN = {
			"tab.label": "Skills & MCP",
			"page.title": "Skill & MCP management",
			"page.subtitle": "Manage nested skill discovery, per-skill switches, duplicate names, and MCP servers.",
			"page.refresh": "Refresh",
			"page.loading": "Reading host state…",
			"page.section.skills": "Skills",
			"page.section.conflicts": "Conflicts",
			"page.section.mcp": "MCP servers",
			"page.section.config": "Discovery settings",
			"status.applied": "Applied",
			"status.restartRequired": "Saved — takes effect after the host restarts",
			"status.refused": "Refused",
			"status.unchanged": "No change needed",
			"status.working": "Working…",
			"status.stale": "State was stale; re-reading",
			"status.staleRetry": "State was stale; re-read and retried",
			"error.load": "The host state could not be read.",
			"error.loadDetail": "The host state could not be read: {reason}",
			"error.retry": "Retry",
			"error.write": "The write did not succeed: {reason}",
			"error.unavailable": "The management endpoint is unavailable on this host.",
			"empty.skills": "No skills were discovered. Check the roots under Discovery settings.",
			"empty.conflicts": "No duplicate skill names.",
			"empty.mcp": "No MCP servers are configured yet.",
			"empty.search": "No skills match “{query}”.",
			"skills.count": "{count} skills",
			"skills.disabledCount": "{count} disabled",
			"skills.ineffectiveCount": "{count} could not be fully disabled",
			"skills.search": "Search skills",
			"skills.searchPlaceholder": "Search by name or description",
			"skills.filterRoot": "Filter by root",
			"skills.filterRootAll": "All roots",
			"skills.group.expand": "Expand group",
			"skills.group.collapse": "Collapse group",
			"skills.group.count": "{count}",
			"skills.uncategorised": "(directly under root)",
			"skills.toggle.enable": "Enable “{name}”",
			"skills.toggle.disable": "Disable “{name}”",
			"skills.state.enabled": "Enabled",
			"skills.state.disabled": "Disabled",
			"skills.state.shadowed": "Hidden here, but still served by {provider}",
			"skills.state.shadowedHint": "A nearer registry layer provides this skill, so this plugin cannot turn it off. The model can still see it.",
			"skills.state.ineffective": "Hidden but not effective",
			"skills.field.path": "File",
			"skills.field.root": "Root",
			"skills.field.category": "Category",
			"skills.field.provider": "Provider",
			"skills.field.rank": "Rank",
			"skills.field.model": "Model-invocable",
			"skills.field.user": "User-invocable",
			"skills.bulk.disableGroup": "Disable every skill in this group",
			"skills.bulk.enableGroup": "Enable every skill in this group",
			"skills.bulk.result": "{ok} succeeded, {failed} failed",
			"conflicts.count": "{count} duplicate names",
			"conflicts.policy": "Current policy: {policy}",
			"conflicts.policy.firstWins": "The first file wins",
			"conflicts.policy.error": "The name is withheld entirely",
			"conflicts.winner": "In effect",
			"conflicts.loser": "Overridden",
			"conflicts.resolvable": "Resolvable by reordering roots or changing the policy",
			"conflicts.unresolvable": "This plugin cannot change the outcome",
			"conflicts.explain.firstWins": "Root order decides the winner; put the root you want first.",
			"conflicts.explain.error": "Under the “error” policy the name is absent from the catalog, so a caller can never act on the wrong instructions.",
			"mcp.count": "{count} servers",
			"mcp.add": "Add server",
			"mcp.edit": "Edit",
			"mcp.remove": "Remove",
			"mcp.cancel": "Cancel",
			"mcp.confirmRemove": "Remove “{name}”?",
			"mcp.toggle.enable": "Enable “{name}”",
			"mcp.toggle.disable": "Disable “{name}”",
			"mcp.field.serverName": "Name",
			"mcp.field.transport": "Transport",
			"mcp.field.command": "Command",
			"mcp.field.args": "Arguments (one per line)",
			"mcp.field.env": "Environment variables",
			"mcp.field.cwd": "Working directory",
			"mcp.field.url": "URL",
			"mcp.field.headers": "Headers",
			"mcp.field.timeout": "Tool call timeout (ms)",
			"mcp.field.failOnStartup": "Fail on startup error",
			"mcp.target": "Target",
			"mcp.phase": "Phase",
			"mcp.tools.count": "{count} tools",
			"mcp.tools.none": "No tools",
			"mcp.tools.list": "Registered tools",
			"mcp.declared.own": "Configured here",
			"mcp.declared.external": "Configured by an outer layer",
			"mcp.readonly.managementRequired": "The harness manages this row; it cannot be changed here",
			"mcp.readonly.unaddressable": "This row is not in a manageable configuration layer",
			"mcp.external.immutable": "Servers from an outer layer can only be toggled, not edited or removed here",
			"mcp.unavailable": "The MCP client is not installed on this host, so servers cannot be connected",
			"mcp.managerUnavailable": "No plugin manager on this host: servers can be listed but not toggled",
			"mcp.nameInvalid": "A name may contain only letters, digits, underscores, or hyphens, 1–32 characters",
			"mcp.nameDuplicate": "The name “{name}” is already in use",
			"mcp.secretMasked": "Hidden — the stored value is kept on save",
			"config.roots": "Skill roots",
			"config.rootsHint": "Absolute paths, one per line.",
			"config.rootsMissing": "The root {path} does not exist or is not a directory",
			"config.maxDepth": "Max depth",
			"config.rank": "Rank",
			"config.duplicatePolicy": "Duplicate name policy",
			"config.includeHidden": "Include hidden directories",
			"config.includeFlatRootFiles": "Include flat files directly under a root",
			"config.watch": "Watch for changes",
			"config.watchDebounceMs": "Watch debounce (ms)",
			"config.providerName": "Provider name",
			"config.save": "Save settings",
			"config.saved": "Settings saved",
			"config.dirty": "Unsaved changes"
};

const UI_ZH = {
			"tab.label": "技能与 MCP",
			"page.title": "技能与 MCP 管理",
			"page.subtitle": "管理分层技能发现、技能开关、同名冲突与 MCP 服务器。",
			"page.refresh": "刷新",
			"page.loading": "正在读取宿主状态…",
			"page.section.skills": "技能",
			"page.section.conflicts": "冲突",
			"page.section.mcp": "MCP 服务器",
			"page.section.config": "发现配置",
			"status.applied": "已生效",
			"status.restartRequired": "已保存，重启宿主后生效",
			"status.refused": "已被拒绝",
			"status.unchanged": "无需更改",
			"status.working": "处理中…",
			"status.stale": "状态已过期，正在重新读取",
			"status.staleRetry": "状态已过期，已重新读取并重试",
			"error.load": "无法读取宿主状态。",
			"error.loadDetail": "无法读取宿主状态：{reason}",
			"error.retry": "重试",
			"error.write": "写入未成功：{reason}",
			"error.unavailable": "管理接口不可用（宿主未挂载该端点）。",
			"empty.skills": "没有发现任何技能。请检查「发现配置」中的根目录。",
			"empty.conflicts": "没有同名冲突。",
			"empty.mcp": "还没有配置 MCP 服务器。",
			"empty.search": "没有匹配「{query}」的技能。",
			"skills.count": "共 {count} 个技能",
			"skills.disabledCount": "已关闭 {count} 个",
			"skills.ineffectiveCount": "{count} 个未能真正关闭",
			"skills.search": "搜索技能",
			"skills.searchPlaceholder": "按名称或描述搜索",
			"skills.filterRoot": "按根目录筛选",
			"skills.filterRootAll": "全部根目录",
			"skills.group.expand": "展开分组",
			"skills.group.collapse": "收起分组",
			"skills.group.count": "{count} 个",
			"skills.uncategorised": "（根目录直接层）",
			"skills.toggle.enable": "启用「{name}」",
			"skills.toggle.disable": "关闭「{name}」",
			"skills.state.enabled": "已启用",
			"skills.state.disabled": "已关闭",
			"skills.state.shadowed": "已隐藏但未生效，仍由 {provider} 提供",
			"skills.state.shadowedHint": "该技能由更近的注册表层提供，本插件无法关闭它。它对模型仍然可见。",
			"skills.state.ineffective": "已隐藏但未生效",
			"skills.field.path": "文件",
			"skills.field.root": "根目录",
			"skills.field.category": "分类",
			"skills.field.provider": "提供方",
			"skills.field.rank": "优先级",
			"skills.field.model": "模型可调用",
			"skills.field.user": "用户可调用",
			"skills.bulk.disableGroup": "关闭该分组全部技能",
			"skills.bulk.enableGroup": "启用该分组全部技能",
			"skills.bulk.result": "成功 {ok} 个，失败 {failed} 个",
			"conflicts.count": "{count} 处同名冲突",
			"conflicts.policy": "当前策略：{policy}",
			"conflicts.policy.firstWins": "先出现的文件获胜",
			"conflicts.policy.error": "该名字整个撤下",
			"conflicts.winner": "生效",
			"conflicts.loser": "被覆盖",
			"conflicts.resolvable": "可通过调整根目录顺序或策略解决",
			"conflicts.unresolvable": "本插件无法改变该结果",
			"conflicts.explain.firstWins": "根目录顺序决定胜者；把想要的根目录排到前面即可改判。",
			"conflicts.explain.error": "策略为「error」时，该名字不会出现在目录中，调用方绝不会读到错的那份。",
			"mcp.count": "{count} 个服务器",
			"mcp.add": "添加服务器",
			"mcp.edit": "编辑",
			"mcp.remove": "删除",
			"mcp.cancel": "取消",
			"mcp.confirmRemove": "确定删除「{name}」？",
			"mcp.toggle.enable": "启用「{name}」",
			"mcp.toggle.disable": "关闭「{name}」",
			"mcp.field.serverName": "名称",
			"mcp.field.transport": "传输方式",
			"mcp.field.command": "命令",
			"mcp.field.args": "参数（每行一个）",
			"mcp.field.env": "环境变量",
			"mcp.field.cwd": "工作目录",
			"mcp.field.url": "地址",
			"mcp.field.headers": "请求头",
			"mcp.field.timeout": "调用超时（毫秒）",
			"mcp.field.failOnStartup": "启动失败即报错",
			"mcp.target": "目标",
			"mcp.phase": "状态",
			"mcp.tools.count": "{count} 个工具",
			"mcp.tools.none": "无工具",
			"mcp.tools.list": "已注册工具",
			"mcp.declared.own": "本插件配置",
			"mcp.declared.external": "外部层配置",
			"mcp.readonly.managementRequired": "该行由 DSH 自身管理，不能从这里改动",
			"mcp.readonly.unaddressable": "该行不在可管理的配置层中",
			"mcp.external.immutable": "外部层的服务器只能开关，不能在这里改配置或删除",
			"mcp.unavailable": "本机未安装 MCP 客户端，无法连接服务器",
			"mcp.managerUnavailable": "本机没有插件管理器，只能查看不能开关",
			"mcp.nameInvalid": "名称只能包含字母、数字、下划线或连字符，长度 1–32",
			"mcp.nameDuplicate": "名称「{name}」已被占用",
			"mcp.secretMasked": "已隐藏（保存时保留原值）",
			"config.roots": "技能根目录",
			"config.rootsHint": "绝对路径，每行一个。",
			"config.rootsMissing": "根目录 {path} 不存在或不是目录",
			"config.maxDepth": "最大深度",
			"config.rank": "优先级",
			"config.duplicatePolicy": "同名冲突策略",
			"config.includeHidden": "包含隐藏目录",
			"config.includeFlatRootFiles": "包含根目录下的平铺文件",
			"config.watch": "监视文件变化",
			"config.watchDebounceMs": "监视防抖（毫秒）",
			"config.providerName": "Provider 名称",
			"config.save": "保存配置",
			"config.saved": "配置已保存",
			"config.dirty": "有未保存的修改"
};

		//#region lib/types/client/page.js
		/**
		 * The management page: skills, conflicts, MCP servers, discovery settings.
		 *
		 * It reads and writes through this plugin's own host routes rather than
		 * `settingsScope`, because DSH serves durable settings only to a loopback
		 * page (`persistence = isLoopback ? "host" : "memory"`). Over a LAN address
		 * every settingsScope card is inert; these routes are not.
		 */

		/** Endpoint paths and operation kinds — mirrors lib/contract.js. */
		const PAGE_CONTRACT = {
			ROUTE_STATE: "/skill-mcp-panel/state",
			ROUTE_APPLY: "/skill-mcp-panel/apply",
			STATE_VERSION: 1,
			STATUS: {
				APPLIED: "applied",
				RESTART_REQUIRED: "restart-required",
				REFUSED: "refused",
				UNCHANGED: "unchanged",
			},
		};

		/**
		 * Read/write the host's management state.
		 *
		 * The revision is re-read after a 409: the host fences writes on it, so a
		 * page that kept its first revision would fail every write after another
		 * writer touched the settings.
		 */
		class PageApi {
			constructor(fetchImpl) {
				this.fetch = fetchImpl ?? ((input, init) => fetch(input, init));
				this.revision = undefined;
			}

			async read() {
				const response = await this.fetch(PAGE_CONTRACT.ROUTE_STATE, {
					headers: { accept: "application/json" },
				});
				if (!response.ok) throw new Error("HTTP " + response.status);
				const state = await response.json();
				if (state?.version !== PAGE_CONTRACT.STATE_VERSION) {
					throw new Error("unsupported state version " + String(state?.version));
				}
				this.revision = state.revision;
				return state;
			}

			async apply(ops) {
				if (this.revision === undefined) await this.read();
				let response = await this.#post(ops, this.revision);
				let retried = false;
				if (response.status === 409) {
					// Stale revision is a concurrency guard, not a user error.
					const fresh = await response.json().catch(() => undefined);
					this.revision = fresh?.state?.revision ?? (await this.read()).revision;
					response = await this.#post(ops, this.revision);
					retried = true;
				}
				if (!response.ok) throw new Error("HTTP " + response.status);
				const body = await response.json();
				this.revision = body?.state?.revision ?? this.revision;
				return { results: body?.results ?? [], state: body?.state, retried };
			}

			#post(ops, revision) {
				return this.fetch(PAGE_CONTRACT.ROUTE_APPLY, {
					method: "POST",
					headers: { "content-type": "application/json", accept: "application/json" },
					body: JSON.stringify({ revision, ops }),
				});
			}
		}

		/** Group skills by their reported category, the root-directly ones first. */
		function groupByCategory(skills) {
			const groups = new Map();
			for (const skill of skills ?? []) {
				const key = typeof skill?.category === "string" ? skill.category : "";
				if (!groups.has(key)) groups.set(key, []);
				groups.get(key).push(skill);
			}
			return [...groups.entries()]
				.sort((a, b) => (a[0] === "" ? -1 : b[0] === "" ? 1 : a[0].localeCompare(b[0])))
				.map(([category, list]) => ({ category, skills: list }));
		}

		/** Filter by name/description and root, case-insensitively. */
		function filterSkills(skills, query, root) {
			const needle = String(query ?? "").trim().toLowerCase();
			return (skills ?? []).filter((skill) => {
				if (root !== undefined && root !== "" && skill?.root !== root) return false;
				if (needle === "") return true;
				return (
					String(skill?.name ?? "").toLowerCase().includes(needle) ||
					String(skill?.description ?? "").toLowerCase().includes(needle)
				);
			});
		}

		/**
		 * The state line for one skill row.
		 *
		 * `invalid` wins over `off`: a row switched off while the host still reports
		 * the name as served elsewhere is NOT off, and showing it as off is the most
		 * misleading thing this page could do.
		 */
		function stateOf(skill) {
			if (skill?.enabled === false) {
				if (skill?.effective === false) {
					return {
						key: "skills.state.shadowed",
						tone: "warn",
						params: { provider: skill?.shadowedBy ?? skill?.provider ?? "?" },
					};
				}
				return { key: "skills.state.disabled", tone: "off" };
			}
			return { key: "skills.state.enabled", tone: "on" };
		}

		/** Map an apply result onto copy. `restart-required` is never "applied". */
		function statusOf(result) {
			switch (result?.status) {
				case PAGE_CONTRACT.STATUS.APPLIED:
					return { key: "status.applied", tone: "ok" };
				case PAGE_CONTRACT.STATUS.RESTART_REQUIRED:
					return { key: "status.restartRequired", tone: "warn" };
				case PAGE_CONTRACT.STATUS.REFUSED:
					return { key: "status.refused", tone: "bad" };
				case PAGE_CONTRACT.STATUS.UNCHANGED:
					return { key: "status.unchanged", tone: "muted" };
				default:
					return { key: "status.refused", tone: "bad" };
			}
		}

		/**
		 * Render one skill row.
		 * @param props - t, skill, busy, onToggle.
		 */
		function SkillRow(props) {
			const { t, skill, busy, onToggle } = props;
			const state = stateOf(skill);
			const [open, setOpen] = react.useState(false);
			return react.createElement(
				"li",
				{ className: "skn_row" },
				react.createElement(
					"div",
					{ className: "skn_rowMain" },
					react.createElement(
						"button",
						{
							type: "button",
							className: "skn_rowToggle",
							"aria-expanded": open,
							onClick: () => setOpen(!open),
						},
						react.createElement("span", { className: "skn_rowName" }, skill.name),
						react.createElement(
							"span",
							{ className: "skn_badge skn_badge-" + state.tone },
							t(state.key, state.params),
						),
					),
					react.createElement("span", { className: "skn_rowDesc" }, skill.description),
					open
						? react.createElement(
								"dl",
								{ className: "skn_facts" },
								...[["skills.field.path", skill.path], ["skills.field.root", skill.root],
									["skills.field.category", skill.category === "" ? t("skills.uncategorised") : skill.category],
									["skills.field.provider", skill.provider], ["skills.field.rank", String(skill.rank)],
									["skills.field.model", skill.modelInvocable ? "✓" : "✗"],
									["skills.field.user", skill.userInvocable ? "✓" : "✗"]]
									.flatMap(([key, value]) => [
										react.createElement("dt", { key: key + "-t" }, t(key)),
										react.createElement("dd", { key: key + "-d" }, value),
									]),
							)
						: null,
					state.tone === "warn"
						? react.createElement("p", { className: "skn_hint" }, t("skills.state.shadowedHint"))
						: null,
				),
				react.createElement("input", {
					type: "checkbox",
					className: "skn_switch",
					role: "switch",
					checked: skill.enabled !== false,
					disabled: busy,
					"aria-label": t(skill.enabled === false ? "skills.toggle.enable" : "skills.toggle.disable", { name: skill.name }),
					onChange: () => onToggle(skill),
				}),
			);
		}

		/**
		 * One MCP server.
		 *
		 * `config` arrives already masked by the host for any key that looks
		 * secret-bearing, so this renders what it is given and never asks for more:
		 * a page that "helpfully" showed the real token would be the leak.
		 */
		function McpServerRow(props) {
			const { t, server, busy, onToggle, writable } = props;
			const [open, setOpen] = react.useState(false);
			const configEntries = Object.entries(server.config ?? {});
			const tools = server.tools ?? [];
			return react.createElement(
				"li",
				{ className: "skn_server" },
				react.createElement(
					"div",
					{ className: "skn_conflictRow" },
					react.createElement("strong", null, server.serverName),
					react.createElement(
						"span",
						{ className: "skn_badge skn_badge-muted" },
						server.declared ? t("mcp.declared.own") : t("mcp.declared.external"),
					),
					react.createElement("span", { className: "skn_muted" }, server.transport),
					react.createElement(
						"span",
						{ className: "skn_badge " + (server.enabled === false ? "skn_badge-off" : "skn_badge-on") },
						// Deliberately NOT `status.applied`: that phrase is reserved for
						// the outcome of a write, and labelling a merely-enabled server
						// with it would blur the one distinction this page must keep —
						// a `restart-required` result is not success.
						server.enabled === false ? t("skills.state.disabled") : t("skills.state.enabled"),
					),
					server.addressable === false
						? react.createElement(
								"span",
								{ className: "skn_badge skn_badge-muted" },
								t(
									server.readOnlyReason === "management-required"
										? "mcp.readonly.managementRequired"
										: "mcp.readonly.unaddressable",
								),
							)
						: null,
				),
				react.createElement("code", null, server.target),
				react.createElement(
					"div",
					{ className: "skn_conflictRow" },
					react.createElement(
						"span",
						{ className: "skn_muted" },
						server.toolCount > 0 ? t("mcp.tools.count", { count: server.toolCount }) : t("mcp.tools.none"),
					),
					server.phase !== null && server.phase !== undefined
						? react.createElement("span", { className: "skn_muted" }, t("mcp.phase") + ": " + String(server.phase))
						: null,
					react.createElement(
						"button",
						{ type: "button", className: "skn_button", "aria-expanded": open, onClick: () => setOpen(!open) },
						open ? t("skills.group.collapse") : t("skills.group.expand"),
					),
				),
				open
					? react.createElement(
							"div",
							null,
							tools.length > 0
								? react.createElement(
										"div",
										null,
										react.createElement("p", { className: "skn_muted" }, t("mcp.tools.list")),
										react.createElement(
											"ul",
											{ className: "skn_rows" },
											...tools.map((tool) =>
												react.createElement(
													"li",
													{ key: tool.name, className: "skn_row" },
													react.createElement("code", null, tool.name),
													react.createElement("span", { className: "skn_rowDesc" }, tool.description),
												),
											),
										),
									)
								: null,
							configEntries.length > 0
								? react.createElement(
										"dl",
										{ className: "skn_facts" },
										...configEntries.flatMap(([key, value]) => [
											react.createElement("dt", { key: key + "-t" }, key),
											react.createElement(
												"dd",
												{ key: key + "-d" },
												typeof value === "object" && value !== null
													? Object.entries(value)
															.map(([inner, innerValue]) => inner + "=" + String(innerValue))
															.join("\n")
													: String(value),
											),
										]),
									)
								: null,
							react.createElement("p", { className: "skn_hint" }, t("mcp.secretMasked")),
						)
					: null,
				server.declared === false
					? react.createElement("p", { className: "skn_hint" }, t("mcp.external.immutable"))
					: null,
				server.addressable === false || writable === false
					? null
					: react.createElement("input", {
							type: "checkbox",
							className: "skn_switch",
							role: "switch",
							checked: server.enabled !== false,
							disabled: busy,
							"aria-label": t(server.enabled === false ? "mcp.toggle.enable" : "mcp.toggle.disable", { name: server.serverName }),
							onChange: () => onToggle(server),
						}),
			);
		}

		/**
		 * The page body. Loads state on mount, so an unavailable settingsScope has
		 * no effect on whether this renders.
		 */
		function SkillNestingPage(props) {
			const t = props.t;
			const api = react.useMemo(() => new PageApi(props.fetchImpl), []);
			const [state, setState] = react.useState(undefined);
			const [error, setError] = react.useState(undefined);
			const [busy, setBusy] = react.useState(false);
			const [query, setQuery] = react.useState("");
			const [root, setRoot] = react.useState("");
			const [openGroups, setOpenGroups] = react.useState({});
			const [notice, setNotice] = react.useState(undefined);

			const load = react.useCallback(() => {
				setError(undefined);
				api.read().then(setState, (problem) => setError(String(problem?.message ?? problem)));
			}, [api]);

			react.useEffect(() => load(), [load]);

			const toggle = react.useCallback(
				(skill) => {
					setBusy(true);
					setNotice(undefined);
					api
						.apply([{ kind: "skill.toggle", name: skill.name, enabled: skill.enabled === false }])
						.then(
							(outcome) => {
								if (outcome.state !== undefined) setState(outcome.state);
								const first = outcome.results[0];
								if (first !== undefined) {
									const shown = statusOf(first);
									setNotice({ key: shown.key, tone: shown.tone, name: skill.name });
								}
							},
							(problem) => setNotice({ key: "error.write", tone: "bad", params: { reason: String(problem?.message ?? problem) } }),
						)
						.then(() => setBusy(false));
				},
				[api],
			);

			// The same three-state reporting as a skill toggle: a server that could
			// not be mounted live says so rather than reading as success.
			const toggleServer = react.useCallback(
				(server) => {
					setBusy(true);
					setNotice(undefined);
					api
						.apply([{ kind: "mcp.toggle", serverName: server.serverName, enabled: server.enabled === false }])
						.then(
							(outcome) => {
								if (outcome.state !== undefined) setState(outcome.state);
								const first = outcome.results[0];
								if (first !== undefined) {
									const shown = statusOf(first);
									setNotice({ key: shown.key, tone: shown.tone, name: server.serverName });
								}
							},
							(problem) => setNotice({ key: "error.write", tone: "bad", params: { reason: String(problem?.message ?? problem) } }),
						)
						.then(() => setBusy(false));
				},
				[api],
			);

			if (error !== undefined) {
				return react.createElement(
					"div",
					{ className: "skn_page" },
					react.createElement("p", { className: "skn_error", role: "alert" }, t("error.loadDetail", { reason: error })),
					react.createElement("button", { type: "button", className: "skn_button", onClick: load }, t("error.retry")),
				);
			}
			if (state === undefined) {
				return react.createElement("div", { className: "skn_page" }, react.createElement("p", { className: "skn_muted" }, t("page.loading")));
			}

			const skills = filterSkills(state.skills, query, root);
			const groups = groupByCategory(skills);
			const conflicts = state.conflicts ?? [];
			const servers = state.mcp?.servers ?? [];

			return react.createElement(
				"div",
				{ className: "skn_page" },
				react.createElement(
					"div",
					{ className: "skn_pageHead" },
					react.createElement("h3", { className: "skn_pageTitle" }, t("page.title")),
					react.createElement("p", { className: "skn_muted" }, t("page.subtitle")),
					react.createElement("button", { type: "button", className: "skn_button", onClick: load }, t("page.refresh")),
				),

				notice !== undefined
					? react.createElement(
							"p",
							{ className: "skn_notice skn_badge-" + notice.tone, role: "status" },
							t(notice.key, notice.params),
						)
					: null,

				(state.errors ?? []).length > 0
					? react.createElement(
							"ul",
							{ className: "skn_errors" },
							...(state.errors ?? []).map((message, index) =>
								react.createElement("li", { key: "e" + index }, message),
							),
						)
					: null,

				// ── skills ────────────────────────────────────────────────────
				react.createElement("h4", { className: "skn_section" }, t("page.section.skills")),
				react.createElement(
					"div",
					{ className: "skn_filters" },
					react.createElement("input", {
						type: "search",
						className: "skn_input",
						placeholder: t("skills.searchPlaceholder"),
						"aria-label": t("skills.search"),
						value: query,
						onChange: (event) => setQuery(event.target.value),
					}),
					react.createElement(
						"select",
						{
							className: "skn_input",
							"aria-label": t("skills.filterRoot"),
							value: root,
							onChange: (event) => setRoot(event.target.value),
						},
						react.createElement("option", { value: "" }, t("skills.filterRootAll")),
						...(state.roots ?? []).map((entry) =>
							react.createElement("option", { key: entry.path, value: entry.path }, entry.path),
						),
					),
					react.createElement("span", { className: "skn_muted" }, t("skills.count", { count: skills.length })),
				),

				groups.length === 0
					? react.createElement("p", { className: "skn_muted" }, query === "" ? t("empty.skills") : t("empty.search", { query }))
					: react.createElement(
							"ul",
							{ className: "skn_groups" },
							...groups.map((group) => {
								// Collapsed by default: 135 rows must not all render at once.
								// A search or root filter forces its matches open, because a
								// filtered list the user cannot see reads as "no results".
								const open = openGroups[group.category] === true || query.trim() !== '' || root !== '';
								return react.createElement(
									"li",
									{ key: group.category || "(root)", className: "skn_group" },
									react.createElement(
										"button",
										{
											type: "button",
											className: "skn_groupHead",
											"aria-expanded": open,
											onClick: () => setOpenGroups({ ...openGroups, [group.category]: !open }),
										},
										react.createElement("span", null, group.category === "" ? t("skills.uncategorised") : group.category),
										react.createElement("span", { className: "skn_muted" }, t("skills.group.count", { count: group.skills.length })),
									),
									open
										? react.createElement(
												"ul",
												{ className: "skn_rows" },
												...group.skills.map((skill) =>
													react.createElement(SkillRow, { key: skill.name, t, skill, busy, onToggle: toggle }),
												),
											)
										: null,
								);
							}),
						),

				// ── conflicts ─────────────────────────────────────────────────
				react.createElement("h4", { className: "skn_section" }, t("page.section.conflicts")),
				conflicts.length === 0
					? react.createElement("p", { className: "skn_muted" }, t("empty.conflicts"))
					: react.createElement(
							"ul",
							{ className: "skn_conflicts" },
							...conflicts.map((conflict) =>
								react.createElement(
									"li",
									{ key: conflict.name, className: "skn_conflict" },
									react.createElement("strong", null, conflict.name),
									react.createElement(
										"span",
										{ className: "skn_muted" },
										t("conflicts.policy", {
											policy:
												conflict.policy === "error"
													? t("conflicts.policy.error")
													: t("conflicts.policy.firstWins"),
										}),
									),
									react.createElement(
										"div",
										{ className: "skn_conflictRow" },
										react.createElement("span", { className: "skn_badge skn_badge-on" }, t("conflicts.winner")),
										react.createElement("code", null, conflict.winner?.path),
										react.createElement("span", { className: "skn_muted" }, conflict.winner?.provider),
									),
									...(conflict.losers ?? []).map((loser) =>
										react.createElement(
											"div",
											{ key: loser.path, className: "skn_conflictRow" },
											react.createElement("span", { className: "skn_badge skn_badge-muted" }, t("conflicts.loser")),
											react.createElement("code", null, loser.path),
											react.createElement("span", { className: "skn_muted" }, loser.provider),
										),
									),
									react.createElement(
										"p",
										{ className: "skn_hint" },
										conflict.policy === "error" ? t("conflicts.explain.error") : t("conflicts.explain.firstWins"),
									),
								),
							),
						),

				// ── MCP ───────────────────────────────────────────────────────
				react.createElement("h4", { className: "skn_section" }, t("page.section.mcp")),
				state.mcp?.mcpClientAvailable === false
					? react.createElement("p", { className: "skn_hint" }, t("mcp.unavailable"))
					: null,
				state.mcp?.managerAvailable === false
					? react.createElement("p", { className: "skn_hint" }, t("mcp.managerUnavailable"))
					: null,
				servers.length === 0
					? react.createElement("p", { className: "skn_muted" }, t("empty.mcp"))
					: react.createElement(
							"ul",
							{ className: "skn_servers" },
							...servers.map((server) =>
								react.createElement(McpServerRow, { key: server.serverName, t, server, busy, onToggle: toggleServer, writable: state.writable !== false }),
							),
						),

				// ── config ────────────────────────────────────────────────────
				react.createElement("h4", { className: "skn_section" }, t("page.section.config")),
				react.createElement(
					"dl",
					{ className: "skn_facts" },
					...[
						["config.roots", (state.config?.roots ?? []).join("\n")],
						["config.maxDepth", String(state.config?.maxDepth)],
						["config.rank", String(state.config?.rank)],
						["config.duplicatePolicy", String(state.config?.duplicatePolicy)],
						["config.providerName", String(state.config?.providerName)],
						["config.watch", state.config?.watch ? "✓" : "✗"],
						["config.includeHidden", state.config?.includeHidden ? "✓" : "✗"],
						["config.includeFlatRootFiles", state.config?.includeFlatRootFiles ? "✓" : "✗"],
					].flatMap(([key, value]) => [
						react.createElement("dt", { key: key + "-t" }, t(key)),
						react.createElement("dd", { key: key + "-d" }, value),
					]),
				),
			);
		}
		//#endregion

		const inject = ["slots", "locale", "settingsScope"];

		/**
		 * Register this plugin's dictionaries and claim its card cell.
		 *
		 * The card key is the settings namespace: the Plugins page enumerates every
		 * namespace the Host serves and dispatches exactly that key, so a served
		 * namespace with no card renders nothing, and a card whose namespace the Host
		 * does not serve is never dispatched.
		 */
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			// One registration per locale: the locale service rejects a second
			// `register` for a locale a namespace already has, so the card copy and
			// the page copy are merged into a single dictionary per language.
			ctx.effect(
				() =>
					ctx.locale.register(NS, {
						zh: { ...zh, ...UI_ZH },
						en: { ...en, ...UI_EN },
					}),
				"skill-mcp-panel: dictionaries",
			);

			const form = new CardForm(ctx.settingsScope.bind({ namespace: NS }));
			const store = form.bind(() => form.shell());
			// The form owns its store; its scope subscription is disposed with the
			// scope itself, so this effect only stops the store from publishing into a
			// torn-down card.
			ctx.effect(
				() => () => form.dispose(),
				"skill-mcp-panel: card store",
			);

			ctx.slots.inject("settings.plugin.item", () =>
				ctx.slots.register({ name: "settings.plugin.item", key: NS, locale: NS }, (props) =>
					react.createElement(SkillNestingCard, { t: props.t ?? t, form, store }),
				),
			);

			// The management page. Its data comes from this plugin's own host routes,
			// never from `settingsScope`, so it still works on a host where the
			// durable settings scope is unavailable (a non-loopback page). It is
			// registered outside any scope-bound inject for exactly that reason.
			const pageT = (key, params) => ctx.locale.bind(NS)(key, params);
			ctx.slots.inject("settings.plugins.tab", () =>
				ctx.slots.register(
					{ name: "settings.plugins.tab", id: NS, order: 20, locale: NS, label: () => pageT("tab.label") },
					(props) => react.createElement(SkillNestingPage, { t: props.t ?? pageT, fetchImpl: props.fetchImpl }),
				),
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});