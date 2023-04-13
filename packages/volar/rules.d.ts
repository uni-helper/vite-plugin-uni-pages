import * as json from 'vscode-json-languageservice';

declare module '@volar/language-service' {
	interface RuleContext {
		json?: {
			document: json.JSONDocument;
			languageService: json.LanguageService;
		}
	}
}