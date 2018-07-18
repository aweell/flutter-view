import * as indent from 'indent-string';
import { merge, union, pull, fromPairs } from 'lodash';
import { Param, Widget } from './flutter-model';
import { multiline, unquote } from './tools';
import { RenderPlugin } from './watcher';
import { Options } from './watcher';

export function renderDartFile(widgets: Widget[], imports: string[], plugins: RenderPlugin[], options: Options) : string {
	const allImports = union(options.imports, imports)
	return multiline(
		renderClassImports(options.imports),
		'',
		widgets
			.map(widget=>renderClass(widget, plugins, options))
			.join('\r\n'),
		'',
		renderHelpers()
	)

	function renderClassImports(imports: string[]) : string {
		if(!imports) return ''
		return imports.map(_import => `import '${_import}';`).join('\r\n')
	}

	function renderHelpers() : string {
		return multiline(
			'List<Widget> __flatten(List list) {',
			indent(
				multiline(
					'return List<Widget>.from(list.expand((item) {',
					indent(
						'return item is Iterable ? item : [item as Widget];',
						options.indentation
					),
					'}));'
				),
				options.indentation
			),
			'}'
		)
	}

}

export function renderClass(widget: Widget, plugins: RenderPlugin[], options: Options) : string | null {
	const fields = getClassFields(widget)
	const vModelTypeParam = findParam(widget, 'vModelType')
	const vModelType = vModelTypeParam ? vModelTypeParam.value : null
	console.log(vModelType)

	const child = findParam(widget, 'child').value as Widget
	const built = renderWidget(child)
	return multiline(
		`class ${widget.name} extends StatelessWidget {`,
		indent(multiline(
			'',
			vModelType ? `final ${vModelType} __scopedModel;` : null,
			renderClassFields(fields),
			'',
			renderConstructor(widget.name, fields),
			'',
			multiline(
				`@override`,
				`Widget build(BuildContext context) {`,
				(
					vModelType ?
						indent(multiline(
							`final widget = ${built};`,
							`return (__scopedModel != null) ?`,
							indent(multiline(
								`ScopedModel<${vModelType}>(model: __scopedModel, child: widget) `,
								`: widget;`
							), options.indentation)
						), options.indentation)
						: indent(`return ${built};`, options.indentation)
				),
				`}`
			),
			''
		), options.indentation),
		'}'
	)

	function getClassFields(widget: Widget) {
		if(widget.params) {
			return widget.params
				.filter(p=>p.type=='expression')
				.map(p=>({ name: p.name, value: (p.value ? p.value.toString() : null) }))
		} else {
			return []
		}
	}
	
	function renderClassFields(fields: { name: string, value: string }[]) : string {
		return fields
			.map(field=> {
				if(field.value && field.value != 'true') {
					return `final ${field.name} = ${field.value};`
				} else {
					return `final ${field.name};`
				}
			})
			.join('\n')
	}
	
	function renderConstructor(name: string, fields: { name: string, value: string }[]) : string {
		if(vModelType) {
			return `${name}({ ${vModelType} model, ${fields.map(f=>`this.${f.name}`).join(', ')} })  : __scopedModel = model;`
		} else {
			return `${name}({ ${fields.map(f=>`this.${f.name}`).join(', ')} });`
		}
	}
	
	function renderWidget(widget: Widget) : string {

		// if this widget has v-model, wrap it with a ScopedModelDescendant
		const vModelParam = findParam(widget, 'vModel')
		if(vModelParam) {
			pull(widget.params, vModelParam)
			if(vModelType) {
				return multiline(
					`ScopedModelDescendant<${vModelType}>(`,
					indent(multiline(
						`builder: (context, widget, ${vModelParam.value}) {`,
						indent(`return ${renderWidget(widget)};`, options.indentation),
						`}`
					), options.indentation),
					`)`
				)
			}
		}

		// if this widget has v-if, write code that either renders the widget,
		// or that replaces it with an empty container.
		const vIfParam = findParam(widget, 'vIf')
		if(vIfParam) {
			pull(widget.params, vIfParam)
			return `${vIfParam.value} ? ${renderWidget(widget)} : Container()`
		}

		// if this widget has v-for, repeatedly render it
		const vForParam = findParam(widget, 'vFor')
		if(vForParam) {
			const result = parseVForExpression(vForParam.value as string)
			pull(widget.params, vForParam)
			return multiline(
				`this.${result.list}.map((${result.param}) {`,
				indent(multiline(
					`return`,
					renderWidget(widget)+';'
				), options.indentation),
				`})`,
			)
		}

		const renderedParams = renderParams()

		// render the widget class with the parameters
		return multiline(
			`${widget.constant?'const ':''}${widget.name}(`,
			indent(renderedParams, options.indentation),
			`)`
		)

		function parseVForExpression(expression: string) {
			const regexp = /(\w+) in ([\w.]+)/g
			const match = regexp.exec(expression)
			if(match) return { param: match[1], list: match[2] }
			else throw `Invalid v-for expression: "${expression}"`
		}

		function renderParams() : string {
			const renderedParams : string[] = []
			const paramsToRender = widget.params ? widget.params.filter(param=>param.name!='value'&&param.name!='const') : null
			if(paramsToRender) {
				for(var param of paramsToRender) {
					if(param.name) {
						const name = unquote(param.name)
						renderedParams.push(`${name}: ${renderParamValue()}`)
					} else {
						renderedParams.push(renderParamValue())
					}
				}
			}
			return renderedParams.join(',\n')
			
			function renderParamValue() : string {
				switch(param.type) {
					case 'literal': {
						return `'${param.value}'`
					}
					case 'expression': {
						return `${param.value ? param.value.toString() : ''}`
					}
					case 'widget': {
						const value = param.value as Widget
						// const _const = value.params ? 'const ' : ''
						const _const = ''
						return `${_const}${renderWidget(param.value as Widget)}`
					}
					case 'widgets': {
						const widgets = param.value as Widget[]
						const values = widgets.map(widget=>`${renderWidget(widget)}`)
						return multiline(
							`__flatten([`,
							indent(values.join(',\n'), options.indentation),
							`])`
						)
					}
				}
				throw `unknown parameter type ${param.type}`
			}
		}
	}

	function findParam(widget: Widget, name: string) : Param | null {
		if(!widget.params) return null
		return widget.params.find(param => param.name==name)
	}
		
}

