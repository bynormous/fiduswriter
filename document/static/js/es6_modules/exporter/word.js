import {modelToEditor} from "../editor/node-convert"
import {downloadFile} from "./download"
import {createSlug, getDatabasesIfNeeded} from "./tools"
import {FormatCitations} from "../citations/format"
import {fidusSchema} from "../editor/schema"

import JSZip from "jszip"
import JSZipUtils from "jszip-utils"

/*
Exporter to Microsoft Word.

This exporter is *very* experimental. Do not count on using it unless you
have the time to fix it.

TODO:
* footnotes
* equations (inline and figure)
*/


export class WordExporter {
    constructor(doc, bibDB, imageDB) {
        let that = this
        this.doc = doc
        // We use the doc in the pm format as this is what we will be using
        // throughout the application in the future.
        this.pmDoc = modelToEditor(this.doc)
        this.template = false
        this.zip = false
        this.xmlDocs = {}
        this.extraFiles = {}
        this.maxRelId = {}
        this.citInfos = []
        this.citFm = false
        this.pmCits = []
        this.docTitle = this.pmDoc.child(0).textContent
        this.bibDB = bibDB
        this.imageDB = imageDB
        this.imgIdTranslation = {}
        getDatabasesIfNeeded(this, doc, function() {
            that.exporter()
        })
    }

    getTemplate(callback) {
        let that = this
        JSZipUtils.getBinaryContent(
            staticUrl + 'docx/template.docx',
            function(err, template){
                that.template = template
                callback()
            }
        )
    }

    exporter() {
        let that = this
        this.formatCitations()

        this.getTemplate(function(){
            that.zip = new JSZip()
            that.zip.loadAsync(that.template).then(function(){
                let p = []
                p.push(that.zipToXml("word/document.xml"))
                p.push(that.zipToXml("word/_rels/document.xml.rels"))
                p.push(that.zipToXml("[Content_Types].xml"))
                window.Promise.all(p).then(function(){

                    that.findMaxRelId("word/_rels/document.xml.rels")
                    that.exportImages(function(){
                        that.getTagData()
                        that.render()
                        that.prepareAndDownload()
                    })
                })
            })

        })
    }

    // Go through a rels xml file and file all the listed relations
    findMaxRelId(filePath) {
        let xml = this.xmlDocs[filePath]
        let rels = [].slice.call(xml.querySelectorAll('Relationship'))
        let maxId = 0

        rels.forEach(function(rel){
            let id = parseInt(rel.getAttribute("Id").replace(/\D/g,''))
            if (id > maxId) {
                maxId = id
            }
        })

        this.maxRelId[filePath] = maxId

    }

    // go through document.xml looking for tags and replace them with the given
    // replacements.
    render() {

        let pars = [].slice.call(this.xmlDocs['word/document.xml'].querySelectorAll('p,sectPr')) // Including global page definition at end
        let currentTags = [], that = this

        pars.forEach(function(par){
            let text = par.textContent // Assuming there is nothing outside of <w:t>...</w:t>
            that.tags.forEach(function(tag){
                let tagString = tag.title
                if(text.indexOf('{'+tagString+'}') !== -1) {
                    currentTags.push(tag)
                    tag.par = par
                    // We don't worry about the same tag appearing twice in the document,
                    // as that would make no sense.
                }
            })

            let pageSize = par.querySelector('pgSz')
            let pageMargins = par.querySelector('pgMar')
            let cols = par.querySelector('cols')
            if (pageSize && pageMargins && cols) { // Not sure if these all need to come together
                let width = parseInt(pageSize.getAttribute('w:w')) -
                parseInt(pageMargins.getAttribute('w:right')) -
                parseInt(pageMargins.getAttribute('w:left'))
                let height = parseInt(pageSize.getAttribute('w:h')) -
                parseInt(pageMargins.getAttribute('w:bottom')) -
                parseInt(pageMargins.getAttribute('w:top')) -
                parseInt(pageMargins.getAttribute('w:header')) -
                parseInt(pageMargins.getAttribute('w:footer'))

                let colCount = parseInt(cols.getAttribute('w:num'))
                if (colCount > 1) {
                    let colSpace = parseInt(cols.getAttribute('w:space'))
                    width = width - (colSpace * (colCount-1))
                    width = width / colCount
                }
                while (currentTags.length) {
                    let tag = currentTags.pop()
                    tag.dimensions = {
                        width: width * 635, // convert to EMU
                        height: height * 635 // convert to EMU
                    }
                }

            }

        })
        this.tags.forEach(function(tag){
            if(tag.title[0]==='@') {
                that.parRender(tag)
            } else {
                that.inlineRender(tag)
            }
        })
    }

    // add an image to the ist of files
    addImage(imgFileName, image, relFilePath) {
        let rId = this.addImageRel(imgFileName, relFilePath)
        this.addContentType(imgFileName.split('.').pop())
        this.extraFiles[`word/media/${imgFileName}`] = image
        return rId
    }

    // add a global contenttype declaration for an image type (if needed)
    addContentType(fileEnding) {
        let xml = this.xmlDocs['[Content_Types].xml']
        let types = xml.querySelector('Types')
        let contentDec = types.querySelector('Default[Extension='+fileEnding+']')
        if (!contentDec) {
            let string = `<Default ContentType="image/${fileEnding}" Extension="${fileEnding}"/>`
            types.insertAdjacentHTML('beforeend', string)
        }
    }

    // add a relationship for an image
    addImageRel(imgFileName, xmlFilePath) {
        let xml = this.xmlDocs[xmlFilePath]
        let rels = xml.querySelector('Relationships')
        let rId = this.maxRelId[xmlFilePath] + 1
        let string = `<Relationship Id="rId${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${imgFileName}"/>`
        rels.insertAdjacentHTML('beforeend', string)
        this.maxRelId[xmlFilePath] = rId
        return rId
    }

    // Add a relationship for a link
    addLinkRel(link, xmlFilePath) {
        let xml = this.xmlDocs[xmlFilePath]
        let rels = xml.querySelector('Relationships')
        let rId = this.maxRelId[xmlFilePath] + 1
        let string = `<Relationship Id="rId${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${link}" TargetMode="External"/>`
        rels.insertAdjacentHTML('beforeend', string)
        this.maxRelId[xmlFilePath] = rId
        return rId
    }

    // Find all images used in file and add these to the export zip.
    // TODO: This will likely fail on image types docx doesn't support such as SVG. Try out and fix.
    exportImages(callback) {
        let that = this, usedImgs = []

        this.pmDoc.descendants(
            function(node) {
                if (node.type.name==='figure' && node.attrs.image) {
                    if (!(node.attrs.image in usedImgs)) {
                        usedImgs.push(node.attrs.image)
                    }
                }
            }
        )

        let p = []

        usedImgs.forEach((image) => {
            let imgDBEntry = that.imageDB.db[image]
            p.push(
                new window.Promise((resolve) => {
                    JSZipUtils.getBinaryContent(
                        imgDBEntry.image,
                        function(err, imageFile) {
                            let wImgId = that.addImage(
                                imgDBEntry.image.split('/').pop(),
                                imageFile,
                                'word/_rels/document.xml.rels'
                            )
                            that.imgIdTranslation[image] = wImgId
                            resolve()
                        }
                    )
                })
            )
        })

        window.Promise.all(p).then(function(){
            callback()
        })
    }

    // Citations are highly interdependent -- so we need to format them all
    // together before laying out the document.
    formatCitations() {
        let that = this
        this.pmDoc.descendants(
            function(node){
                if (node.type.name==='citation') {
                    that.citInfos.push(node.attrs)
                }
            }
        )
        this.citFm = new FormatCitations(
            this.citInfos,
            this.doc.settings.citationstyle,
            this.bibDB,
            function() {
                that.formatCitationsTwo()
            }
        )
        this.citFm.init()
    }

    formatCitationsTwo() {
        // There could be some formatting in the citations, so we parse them through the PM schema for final formatting.
        // We need to put the citations each in a paragraph so that it works with
        // the fiduswriter schema and so that the converter doesn't mash them together.
        let citationsHTML = ''
        this.citFm.citationTexts.forEach(function(ct){
            citationsHTML += '<p>'+ct[0][1]+'</p>'
        })

        // We create a standard document DOM node, add the citations
        // into the last child (the body) and parse it back.
        let dom = fidusSchema.parseDOM(document.createTextNode('')).toDOM()
        dom.lastElementChild.innerHTML = citationsHTML
        this.pmCits = fidusSchema.parseDOM(dom).lastChild.toJSON().content

        // Now we do the same for the bibliography.
        dom = fidusSchema.parseDOM(document.createTextNode('')).toDOM()
        dom.lastElementChild.innerHTML = this.citFm.bibliographyHTML
        // Remove empty bibliography header (used in web version)
        dom.lastElementChild.removeChild(dom.lastElementChild.firstElementChild)
        this.pmBib = fidusSchema.parseDOM(dom).lastChild.toJSON()
        // use the References style for the paragraphs in the bibliography
        this.pmBib.type = 'bibliography'
    }

    zipToXml(filePath) {
        const parser = new window.DOMParser(), that = this
        return this.zip.file(filePath).async('string').then(
            function(string) {
                that.xmlDocs[filePath] = parser.parseFromString(string, "text/xml")
            }
        )

    }

    xmlToZip(filePath) {
	    const serializer = new window.XMLSerializer()
	    const string = serializer.serializeToString(this.xmlDocs[filePath])
        this.zip.file(filePath, string)
    }

    // Render Tags that only exchange inline content
    inlineRender(tag) {
        let texts = tag.par.textContent.split('{'+tag.title+'}')
        let fullText = texts[0] + this.escapeText(tag.content) + texts[1]
        let rs = [].slice.call(tag.par.querySelectorAll('r'))
        while (rs.length > 1) {
            rs[0].parentNode.removeChild(rs[0])
            rs.shift()
        }
        let r = rs[0]
        r.innerHTML = '<w:t>' + fullText + '</w:t>'
    }

    // Render tags that exchange paragraphs
    parRender(tag) {
        let outXML = this.transformRichtext(
            tag.content,
            {dimensions: tag.dimensions}
        )
        tag.par.insertAdjacentHTML('beforebegin', outXML)
        // sectPr contains information about columns, etc. We need to move this
        // to the last paragraph we will be adding.
        let sectPr = tag.par.querySelector('sectPr')
        if (sectPr) {
            let pPr = tag.par.previousElementSibling.querySelector('pPr')
            pPr.appendChild(sectPr)
        }
        tag.par.parentNode.removeChild(tag.par)
    }


    getTagData() {

        this.tags = [
            {
                title: 'title',
                content: this.pmDoc.child(0).textContent
            },
            {
                title: 'subtitle',
                content: this.pmDoc.child(1).textContent
            },
            {
                title: 'authors',
                content: this.pmDoc.child(2).textContent
            },
            {
                title: '@abstract', // The '@' triggers handling as block
                content: this.pmDoc.child(3).toJSON()
            },
            {
                title: 'keywords',
                content: this.pmDoc.child(4).textContent
            },
            {
                title: '@body', // The '@' triggers handling as block
                content: this.pmDoc.child(5).toJSON()
            },
            {
                title: '@bibliography', // The '@' triggers handling as block
                content: this.pmBib
            }
        ]
    }


    prepareAndDownload() {
        let that = this
        for (let fileName in this.xmlDocs) {
            this.xmlToZip(fileName)
        }
        for (let fileName in this.extraFiles) {
            this.zip.file(fileName, this.extraFiles[fileName])
        }
        this.zip.generateAsync({type:"blob"}).then(function(out){
            downloadFile(createSlug(that.docTitle)+'.docx', out)
        })
    }

    escapeText(text) {
		return text
            .replace(/"/g, '&quot;')
            .replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
    }

    transformRichtext(node, options) {
        let start = '', content = '', end = ''

        switch(node.type) {
            case 'body':
                options = _.clone(options)
                options.section = 'Normal'
                break
            case 'abstract':
                options = _.clone(options)
                options.section = 'Abstract'
                break
            case 'bibliography':
                options = _.clone(options)
                options.section = 'References'
                break
            case 'paragraph':
                // This should really be something like
                // '<w:p w:rsidR="A437D321" w:rsidRDefault="2B935ADC">'
                // See: https://blogs.msdn.microsoft.com/brian_jones/2006/12/11/whats-up-with-all-those-rsids/
                // But tests with Word 2016/LibreOffice seem to indicate that it
                // doesn't care if the attributes are missing.
                // We may need to add them later, if it turns out this is a problem
                // for other versions of Word. In that case we should also add
                // it to settings.xml as described in above link.
                start += '<w:p>'
                start += '<w:pPr><w:pStyle w:val="'+options.section+'"/>'
                if (options.list_type) {
                    start += '<w:numPr><w:ilvl w:val="'+options.list_depth+'"/>'
                    start += '<w:numId w:val="'+options.list_type+'"/></w:numPr>'
                } else {
                    start += '<w:rPr></w:rPr>'
                }
                start += '</w:pPr>'
                end += '</w:p>'
                break
            case 'heading':
                start += '<w:p>'
                start += '<w:pPr><w:pStyle w:val="Heading'+node.attrs.level+'"/><w:rPr></w:rPr></w:pPr>'
                end += '</w:p>'
                break
            case 'code':
                start += '<w:p>'
                start += '<w:pPr><w:pStyle w:val="Code"/><w:rPr></w:rPr></w:pPr>'
                end += '</w:p>'
                break
            case 'blockquote':
                // This is imperfect, but Word doesn't seem to provide section/quotation nesting
                options = _.clone(options)
                options.section = 'Quote'
                break
            case 'ordered_list':
                options = _.clone(options)
                options.section = 'ListParagraph'
                options.list_type = '1'
                if (options.list_depth === undefined) {
                    options.list_depth = 0
                } else {
                    options.list_depth = 1
                }
                break
            case 'bullet_list':
                options = _.clone(options)
                options.section = 'ListParagraph'
                options.list_type = '2'
                if (options.list_depth === undefined) {
                    options.list_depth = 0
                } else {
                    options.list_depth = 1
                }
                break
            case 'list_item':
                // Word seems to lack complex nesting options. The styling is applied
                // to child paragraphs. This will deliver correct results in most
                // cases.
                break
            case 'text':
                // Check for hyperlink, bold/strong and italic/em
                let hyperlink, strong, em
                if (node.marks) {
                    strong = _.findWhere(node.marks, {_:'strong'})
                    em = _.findWhere(node.marks, {_:'em'})
                    hyperlink = _.findWhere(node.marks, {_:'link'})
                }

                if (hyperlink) {
                    let refId = this.addLinkRel(hyperlink.href, 'word/_rels/document.xml.rels')
                    start += `<w:hyperlink r:id="rId${refId}"><w:r>`
                    end += '</w:t></w:r></w:hyperlink>'
                } else {
                    start += '<w:r>'
                    end += '</w:t></w:r>'
                }

                if (hyperlink || strong || em) {
                    start += '<w:rPr>'
                    if (strong) {
                        start += '<w:b/><w:bCs/>'
                    }
                    if (em) {
                        start += '<w:i/><w:iCs/>'
                    }
                    if (hyperlink) {
                        start += '<w:rStyle w:val="Hyperlink"/>'
                    }
                    start += '</w:rPr>'
                }
                let textAttr = ''
                if (node.text[0] === ' ' || node.text[node.text.length-1] === ' ') {
                    textAttr += 'xml:space="preserve"'
                }
                start += `<w:t ${textAttr}>`

                content += this.escapeText(node.text)
                break
            case 'citation':
                // We take the first citation from the stack and remove it.
                let cit = this.pmCits.shift()
                for (let i=0; i < cit.content.length; i++) {
                    content += this.transformRichtext(cit.content[i], options)
                }
                break
            case 'figure':
                if(node.attrs.image) {
                    let imgDBEntry = this.imageDB.db[node.attrs.image]
                    let cx = imgDBEntry.width * 9525 // width in EMU
                    let cy = imgDBEntry.height * 9525 // height in EMU
                    // Shrink image if too large for paper.
                    if (cx > options.dimensions.width) {
                        let rel = cy/cx
                        cx = options.dimensions.width
                        cy = cx * rel
                    }
                    if (cy > options.dimensions.height) {
                        let rel = cx/cy
                        cy = options.dimensions.height
                        cx = cy * rel
                    }
                    let rId = this.imgIdTranslation[node.attrs.image]
                    start += `
                    <w:p>
            		  <w:pPr>
            			<w:jc w:val="center"/>
            		  </w:pPr>
            		  <w:r>
            			<w:rPr/>
            			<w:drawing>
            			  <wp:inline distT="0" distB="0" distL="0" distR="0">
            				<wp:extent cx="${cx}" cy="${cy}"/>
            				<wp:docPr id="0" name="Picture" descr=""/>
            				<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
            				  <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
            					<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
            					  <pic:nvPicPr>
            						<pic:cNvPr id="0" name="Picture" descr=""/>
            						<pic:cNvPicPr>
            						  <a:picLocks noChangeAspect="1" noChangeArrowheads="1"/>
            						</pic:cNvPicPr>
            					  </pic:nvPicPr>
            					  <pic:blipFill>
            						<a:blip r:embed="rId${rId}"/>
            						<a:stretch>
            						  <a:fillRect/>
            						</a:stretch>
            					  </pic:blipFill>
            					  <pic:spPr bwMode="auto">
            						<a:xfrm>
            						  <a:off x="0" y="0"/>
            						  <a:ext cx="${cx}" cy="${cy}"/>
            						</a:xfrm>
            						<a:prstGeom prst="rect">
            						  <a:avLst/>
            						</a:prstGeom>
            						<a:noFill/>
            						<a:ln w="9525">
            						  <a:noFill/>
            						  <a:miter lim="800000"/>
            						  <a:headEnd/>
            						  <a:tailEnd/>
            						</a:ln>
            					  </pic:spPr>
            					</pic:pic>
            				  </a:graphicData>
            				</a:graphic>
            			  </wp:inline>
            			</w:drawing>
            		  </w:r>
            		</w:p>
                    <w:p>
                      <w:pPr><w:pStyle w:val="Caption"/><w:rPr></w:rPr></w:pPr>`
                      // TODO: Add "Figure X:"/"Table X": before caption.
                      content += this.transformRichtext({type: 'text', text: node.attrs.caption}, options)

                      end += `
                    </w:p>
            		`
                } else {
                    console.warn('Unhandled node type: figure (equation)')
                }
                break
            default:
                console.warn('Unhandled node type:' + node.type)
                break
        }

        if (node.content) {
            for (let i=0; i < node.content.length; i++) {
                content += this.transformRichtext(node.content[i], options)
            }
        }

        return start + content + end
    }

}
