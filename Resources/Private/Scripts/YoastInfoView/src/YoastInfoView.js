import React, {PureComponent} from 'react';
import PropTypes from 'prop-types';
import {connect} from 'react-redux';
import {$get} from 'plow-js';
import {Icon, Button} from '@neos-project/react-ui-components';
import {neos} from '@neos-project/neos-ui-decorators';
import {selectors} from '@neos-project/neos-ui-redux-store';
import {ContentAssessor, SEOAssessor, Paper, helpers} from 'yoastseo';
import CornerStoneContentAssessor from 'yoastseo/js/cornerstone/contentAssessor';
import CornerstoneSEOAssessor from 'yoastseo/js/cornerstone/seoAssessor';
import {fetchWithErrorHandling} from '@neos-project/neos-ui-backend-connector';
import {Jed} from "jed";
import style from './style.css';

@connect(state => ({
    focusedNodeContextPath: selectors.CR.Nodes.focusedNodePathSelector(state),
    getNodeByContextPath: selectors.CR.Nodes.nodeByContextPath(state)
}))
@neos(globalRegistry => ({
    i18nRegistry: globalRegistry.get('i18n'),
    serverFeedbackHandlers: globalRegistry.get('serverFeedbackHandlers')
}))
export default class YoastInfoView extends PureComponent {
    static propTypes = {
        focusedNodeContextPath: PropTypes.string,
        getNodeByContextPath: PropTypes.func.isRequired
    }

    constructor(props) {
        super(props);
        const {focusedNodeContextPath, getNodeByContextPath, i18nRegistry} = this.props;
        const node = getNodeByContextPath(focusedNodeContextPath);

        this.state = {
            nodeUri: $get('uri', node),
            previewUri: $get('previewUri', node),
            focusKeyword: $get('properties.focusKeyword', node),
            isCornerstone: $get('properties.isCornerstone', node),
            expandGoodResults: false,
            page: {
                title: '',
                description: '',
                isAnalyzing: false
            },
            content: {
                score: 0,
                results: [],
                isAnalyzing: false
            },
            seo: {
                score: 0,
                results: [],
                isAnalyzing: false
            },
            i18n: {}
        };
    }

    componentDidMount() {
        this.fetchTranslations();
        this.fetchContent();
        this.props.serverFeedbackHandlers.set('Neos.Neos.Ui:ReloadDocument/DocumentUpdated', (feedbackPayload, {store}) => {
            this.fetchContent();
        }, 'after Neos.Neos.Ui:ReloadDocument/Main');
    }

    fetchTranslations = () => {
        fetchWithErrorHandling.withCsrfToken(csrfToken => ({
            url: `/neosyoastseo/fetchTranslations`,
            method: 'GET',
            credentials: 'include',
            headers: {
                'X-Flow-Csrftoken': csrfToken,
                'Content-Type': 'application/json'
            }
        }))
            .then(response => response && response.json())
            .then(translations => {
                if (!translations || translations.error) {
                    translations = {
                        domain: "js-text-analysis",
                        // eslint-disable-next-line camelcase
                        locale_data: {
                            "js-text-analysis": {
                                "": {}
                            }
                        }
                    };
                }

                this.setState({
                    i18n: new Jed(translations)
                });
            });
    }

    fetchContent = () => {
        this.setState({
            page: {
                ...this.state.page,
                isAnalyzing: true
            },
            seo: {
                ...this.state.seo,
                isAnalyzing: true
            },
            content: {
                ...this.state.content,
                isAnalyzing: true
            }
        });

        fetchWithErrorHandling.withCsrfToken(csrfToken => ({
            url: `${this.state.nodeUri}?shelYoastSeoPreviewMode=true`,
            method: 'GET',
            credentials: 'include',
            headers: {
                'X-Flow-Csrftoken': csrfToken,
                'Content-Type': 'text/html'
            }
        }))
            .then(response => response && response.text())
            .then(previewDocument => {
                const parser = new DOMParser();
                const parsedPreviewDocument = parser.parseFromString(previewDocument, "text/html");

                const metaSection = parsedPreviewDocument.querySelector('head');

                // Remove problematic tags for the Yoast plugin from preview document
                let scriptTags = parsedPreviewDocument.querySelectorAll('script,svg');
                scriptTags.forEach((scriptTag) => {
                    scriptTag.remove();
                });

                let pageContent = parsedPreviewDocument.querySelector('body').innerHTML;
                let locale = (parsedPreviewDocument.querySelector('html').getAttribute('lang') || 'en_US').replace('-', '_');

                // Remove problematic data attributes for the Yoast plugin from preview document
                const re = /data-.*?=".*?"/gim;
                pageContent = pageContent.replace(re, '');

                this.setState({
                    pageContent: pageContent,
                    page: {
                        locale: locale,
                        title: metaSection.querySelector('title') ? metaSection.querySelector('title').textContent : '',
                        description: metaSection.querySelector('meta[name="description"]') ? metaSection.querySelector('meta[name="description"]').getAttribute('content') : '',
                        isAnalyzing: false
                    },
                    results: {}
                }, this.refreshAnalysis);
            });
    }

    refreshAnalysis = () => {
        let paper = new Paper(
            this.state.pageContent,
            {
                keyword: this.state.focusKeyword,
                description: this.state.page.description,
                title: this.state.page.title,
                titleWidth: this.getTitleWidth(),
                url: this.state.previewUri,
                locale: this.state.page.locale,
                permalink: ""
            }
        );

        this.refreshContentAnalysis(paper);
        this.refreshSeoAnalysis(paper);
    }

    getTitleWidth = () => {
        // TODO: This is just a basic approximation and should be calculated in the future based on the actual text.
        return this.state.page.title.length * 8.5;
    }

    parseResults = (results) => {
        return results.reduce((obj, result) => {
            obj[result._identifier] = {
                identifier: result._identifier,
                rating: helpers.scoreToRating(result.score),
                score: result.score,
                text: result.text
            }
            return obj;
        }, {});
    }

    refreshSeoAnalysis = (paper) => {
        let seoAssessor;
        if (this.state.isCornerstone) {
            seoAssessor = new CornerstoneSEOAssessor(this.state.i18n, {locale: this.state.page.locale});
        } else {
            seoAssessor = new SEOAssessor(this.state.i18n, {locale: this.state.page.locale});
        }
        seoAssessor.assess(paper);

        this.setState({
            seo: {
                score: seoAssessor.calculateOverallScore(),
                results: this.parseResults(seoAssessor.getValidResults()),
                isAnalyzing: false
            }
        });
    }

    refreshContentAnalysis = (paper) => {
        let contentAssessor;
        if (this.state.isCornerstone) {
            contentAssessor = new CornerStoneContentAssessor(this.state.i18n, {locale: this.state.page.locale});
        } else {
            contentAssessor = new ContentAssessor(this.state.i18n, {locale: this.state.page.locale});
        }
        contentAssessor.assess(paper);

        this.setState({
            content: {
                score: contentAssessor.calculateOverallScore(),
                results: this.parseResults(contentAssessor.getValidResults()),
                isAnalyzing: false
            }
        });
    }

    renderResults = (filter) => {
        let groupedResults = {
            'bad': [],
            'ok': [],
            'good': []
        };

        let allResults = Object.assign({}, this.state.content.results, this.state.seo.results);

        Object.values(allResults).forEach(result => {
            if (filter.indexOf(result.identifier) === -1) {
                if (result.rating in groupedResults) {
                    groupedResults[result.rating].push(result);
                } else {
                    console.log(result.text);
                }
            }
        });

        let renderedResults = Object.values(groupedResults).map(group => group.map(result => {
            return this.renderRating(result);
        }));

        return (
            <li className={style.yoastInfoView__item}>
                <div className={style.yoastInfoView__title}>
                    {this.props.i18nRegistry.translate('inspector.results', 'Results', {}, 'Shel.Neos.YoastSeo')}
                </div>
                {groupedResults.bad.map(result => this.renderRating(result))}
                {groupedResults.ok.map(result => this.renderRating(result))}
                {this.state.expandGoodResults && groupedResults.good.map(result => this.renderRating(result))}
            </li>
        );
    }

    handleExpandClick = () => {
        this.setState({expandGoodResults: true});
    }

    renderRating = (result) => {
        return result && (
            <p className={style.yoastInfoView__content}
               title={this.props.i18nRegistry.translate('inspector.resultType.' + result.identifier, result.identifier, {}, 'Shel.Neos.YoastSeo')}>
                <svg height="13" width="6" className={style['yoastInfoView__rating_' + result.rating]}><circle cx="3" cy="9" r="3" /></svg>
                <span dangerouslySetInnerHTML={{__html: result.text}} />
            </p>
        );
    }

    renderTitleRating = () => {
        return (
            <li className={style.yoastInfoView__item}>
                <div className={style.yoastInfoView__title}>
                    {this.props.i18nRegistry.translate('inspector.title', 'Title', {}, 'Shel.Neos.YoastSeo')}
                </div>
                <div className={style.yoastInfoView__value}>{this.state.page.title}</div>
                {this.renderRating(this.state.seo.results.titleWidth)}
                {this.renderRating(this.state.seo.results.titleKeyword)}
            </li>
        );
    }

    renderDescriptionRating = () => {
        return (
            <li className={style.yoastInfoView__item}>
                <div className={style.yoastInfoView__title}>
                    {this.props.i18nRegistry.translate('inspector.description', 'Description', {}, 'Shel.Neos.YoastSeo')}
                </div>
                <div className={style.yoastInfoView__value}>{this.state.page.description}</div>
                {this.renderRating(this.state.seo.results.metaDescriptionKeyword)}
                {this.renderRating(this.state.seo.results.metaDescriptionLength)}
            </li>
        );
    }

    render() {
        let filterFromAllResults = ['titleWidth', 'titleKeyword', 'metaDescriptionKeyword', 'metaDescriptionLength'];

        return (
            <ul className={style.yoastInfoView}>
                {!this.state.content.isAnalyzing && !this.state.seo.isAnalyzing && (
                    <li className={style.yoastInfoView__item}>
                        <div className={style.yoastInfoView__title}>
                            {this.props.i18nRegistry.translate('inspector.contentScore', 'Content Score', {}, 'Shel.Neos.YoastSeo')}: {this.state.content.score}
                        </div>
                        <div className={style.yoastInfoView__title}>
                            {this.props.i18nRegistry.translate('inspector.seoScore', 'SEO Score', {}, 'Shel.Neos.YoastSeo')}: {this.state.seo.score}
                        </div>
                    </li>
                )}

                {!this.state.seo.isAnalyzing && this.renderTitleRating()}
                {!this.state.seo.isAnalyzing && this.renderDescriptionRating()}
                {!this.state.content.isAnalyzing && !this.state.seo.isAnalyzing && this.renderResults(filterFromAllResults)}

                {(this.state.page.isAnalyzing || this.state.content.isAnalyzing || this.state.seo.isAnalyzing) && (
                    <li className={style.yoastInfoView__item} style={{textAlign: 'center'}}>
                        <Icon spin={true} icon={'spinner'}/>
                        &nbsp;{this.props.i18nRegistry.translate('inspector.loading', 'Loading…', {}, 'Shel.Neos.YoastSeo')}
                    </li>
                )}

                {!this.state.page.isAnalyzing && !this.state.expandGoodResults && (
                    <li className={style.yoastInfoView__item} style={{textAlign: 'center'}}>
                        <Button style="clean" hoverStyle="clean" onClick={this.handleExpandClick}>
                            <span>
                                <Icon icon={'plus'}/>
                                &nbsp;{this.props.i18nRegistry.translate('inspector.showAllResults', 'Show all results', {}, 'Shel.Neos.YoastSeo')}
                            </span>
                        </Button>
                    </li>
                )}
            </ul>
        );
    }
}