/**
 * dedalus.js v0.9.4
 * 2013, Gustavo Di Pietro
 * Licensed under the GPL license (http://www.gnu.org/licenses/gpl-2.0.html)
**/


/* Dedalus defines the core functionalities and a base class that must be
 * implemented by a Dedalus implementation.
 *
 * Its constructor loads source story and defines a global "story" variable
 * that can be openly accessed at runtime by the story script.

 * Dedalus depens on:
 *     jQuery: http://jquery.com/
 *     doT.js: http://olado.github.io/doT/index.html
 */

/* ** STRING EXTENSIONS ** */
if (!String.prototype.trim) String.prototype.trim             = function () { return this.replace(/^\s+|\s+$/g, ''); };
if (!String.prototype.ltrim) String.prototype.ltrim           = function () { return this.replace(/^\s+/,''); };
if (!String.prototype.rtrim) String.prototype.rtrim           = function () { return this.replace(/\s+$/,''); };
if (!String.prototype.startsWith) String.prototype.startsWith = function (str) { return this.lastIndexOf(str, 0) === 0; };

var Dedalus,
    story;

(function () {
    "use strict";
    /*jslint evil: true, white: true, nomen: true */
    /*global $, jQuery, doT*/

    /**
     * Base class Dedalus
     * @param  {JSON} options A dictionary of configuration options:
     *                              {
     *                                  domSource:    A jQuery object with the root
     *                                                element containing the story
     *                                                source
     *                                  dedleeSource: If this jQuery element is set,
     *                                                assume that the story is in dadlee
     *                                                format and hosted in this element
     *                              }
     * @return                      A Dedalus instance
     */
    Dedalus = function (options) {
        // Ignore parsing the story source if called as prototype constructor by
        // a class inheriting from this
        this.options       = options;
        if (this.options) {
            this.dedleeSource  = this.options.dedleeSource;
            this.domSource     = this.options.domSource;
            this._story        = this.options ? this.parseStory() : {};
        }

        // Make sure that story is not undefined
        this._story || (this._story = {});

        // Variables to store previous running states to be restored by undo
        // actions
        this.storyUndo     = {};
        this._storyUndo    = {};

        // Publish / Subscribe dispatcher
        this.messageCenter = makeMessageCenter();

        // Set global story
        story = this.generateEmptyStory();
    };

    /**
     * Parse the story file passed by domSource
     * @param  {jQuery} domSource A jQuery object with the root element
     *                            containing the story source
     *
     * @return {JSON}             An object containing all the information
     *                            about the story. This is different from the global
     *                            story variable since its contains more infos that
     *                            are not shared outside the class
     */
    Dedalus.prototype.parseStory = function () {
        var _story = {
                currentPage                 : '',
                title                       : '',
                inventory                   : [],
                pages                       : {},
                paragraphs                  : {},
                objects                     : {},
                initialization              : '',
                intro                       : '',
                numParagraphsShown          : 0,
                numPagesTurned              : 0,
                numParagraphsShownInPage    : 0,
                numTotalActions             : 0,
                numActionsPerformedInPage   : 0,
                combinationActionInProgress : false,
                beforeEveryThing            : function () {},
                beforeEveryPageTurn         : function () {},
                beforeEveryParagraphShown   : function () {},
                afterEveryThing             : function () {},
                afterEveryPageTurn          : function () {},
                afterEveryParagraphShown    : function () {}
            },
            temporaryDomSourceCopy;

        /**
         * Get the title of the story
         * @param  {jQuery} parent Element containing <title>
         * @return {String}        The title of the story
         */
        function getTitleLocal (parent) {
            return parent.find('title').html() || "A Dedalus Story";
        }

        /**
         * Get the custom javascript code to be executed when the story starts
         * running
         * @param  {jQuery} parent Element containing <initscript>
         * @return {String}        Javascript source code to be executed in the
         *                         story initialization fase
         */
        function getInitScript (parent) {
            return parent.find('initscript').text();
        }

        /**
         * Get the html to be present to the player (only once) as introductory
         * text
         * @param  {jQuery} parent Element containing <id="#intro">
         * @return {String}        HTML to be presented
         */
        function getIntroLocal (parent) {
            return parent.find('#intro').html();
        }

        /**
         * Get all the objects and character elements defined within parent. Parent
         * can be either the top level story or one of its sub elements (for example
         * get the objects defined within a page)
         * text
         * @param  {jQuery} parent Element to be searched for <obj> and <character>
         * @return {JSON}   A dictionary mapping the objects found:
         *                  {
         *                      'Object Name': {
         *                          actions:          {
         *                                                'Action Name': {
         *                                                    when:        Function (returning a bool) determining whether
         *                                                                 the action must be presented in a given context
         *                                                    content:     doT template to be printed when the action is executed
         *                                                    with:    {   "with" combinations
         *                                                        'Object to combine with': doT template to be printed when the action is executed
         *                                                    },
         *                                                    hasWith:     Boolean: true if "with" has any value
         *                                                }
         *                                            }
         *                          inventoryName:    Name to be used to present
         *                                            the object once added to
         *                                            the inventory
         *                          getActiveActions: Function returning the actions active in a given moment
         *                                            (determined by calling "when" of actions)
         *                      }
         *                  }
         */
        function getObjects (parent) {
            var objects = {};

            parent.find('obj, character').each(function () {
                var obj           = $(this),
                    id            = obj.attr('id'),
                    inventoryName = obj.attr('inventoryName');

                objects[id] = {
                    actions       : {},
                    inventoryName : inventoryName
                };

                /**
                 * Run "when" on every object action and return those for which
                 * it is true
                 * @return {JSON} A dictionary of active action objects
                 */
                function getActiveActions () {
                    var action,
                        actions = {},
                        object = objects[id];

                    for (action in object.actions) {
                        if (object.actions.hasOwnProperty(action)) {
                            if (object.actions[action].when()) {
                                actions[action] = object.actions[action];
                            }
                        }
                    }
                    return actions;
                }

                // object actions
                obj.find('action').each(function () {
                    var whenCheck        = function () { return true; },
                        action           = $(this),
                        when             = action.find('when').text() || undefined,
                        withCombinations = {},
                        hasCombinations  = false;

                    if (when !== undefined) {
                        whenCheck = function () { return eval(when); };
                    }

                    action.find('when').remove();

                    // combination actions ("with" interactions)
                    action.find('with').each(function () {
                        var withElement  = $(this),
                            withPartner  = withElement.attr('id'),
                            withContent  = doT.template(Dedalus.getRawContent(withElement));

                        withCombinations[withPartner] = withContent;
                        hasCombinations               = true;

                        withElement.remove();
                    });

                    objects[id].actions[action.attr('id')] = {
                        'when'    : whenCheck,
                        'content' : doT.template(Dedalus.getRawContent(action)),
                        'hasWith' : hasCombinations,
                        'with'    : withCombinations
                    };
                });

                objects[id].getActiveActions = getActiveActions;
            });

            return objects;
        }

        /**
         * Get all the paragraphs within parent. Parent can be either the top level
         * story or one of its pages
         * @param  {jQuery} parent Element to be searched for <paragraph>
         * @return {JSON}   A dictionary of paragraph objects:
         *                  {
         *                      'Paragraph Name': {
         *                          content: a doT template for later execution
         *                      }
         *                  }
         */
        function getParagraphs (parent) {
            var paragraphs = {};

            parent.find('paragraph').each(function () {
                var paragraph = $(this),
                    id        = paragraph.attr('id');

                paragraphs[id] = {
                    content: doT.template(Dedalus.getRawContent(paragraph))
                };
            });
            return paragraphs;
        }

        /**
         * Get all the paragraphs within parent
         * @param  {jQuery} parent Element to be searched for <page>
         * @return {JSON}   A dictionary of page objects:
         *                  {
         *                      'Page Name': {
         *                          content:    a doT template for later execution
         *                          objects:    a dictionary of objects (see above)
         *                                      only accesible from within the page
         *                          paragraphs: a dictionary of paragraphs (see above)
         *                                      only accesible from within the page
         *                          isFirst:    true if this is the first page to be
         *                                      shown at startup after displaying the
         *                                      intro (<class="first">)
         *                      }
         *                  }
         */
        function getPages (parent) {
            var pages = {};

            parent.find('page').each(function () {
                var page = $(this),
                    id  = page.attr('id');


                pages[id] = {
                    objects    : getObjects(page),
                    paragraphs : getParagraphs(page),
                    isFirst    : page.hasClass('first')
                };
                page.find('obj, paragraph, character').remove();
                pages[id].content = doT.template(Dedalus.getRawContent(page));

            });
            return pages;
        }

        /**
         * Get the d of the page defined as first to be displayed after the
         * intro
         * @param  {jQuery} parent Element to be searched for <page class="first">
         * @return {String}        Id of the page
         */
        function getInitialCurrentPage (parent) {
            return parent.find('page.first').attr('id');
        }

        /**
         * Get the initial inventory (empty)
         * @return {Array} Empty array
         */
        function getInitialInventory () {
            return [];
        }

        /**
         * Set up _story functions for timed events to be executed before or after
         * page turns, paragraph showing and so on
         * @param  {jQuery} parent Element to be searched for:
         *                         <beforeEveryThing>
         *                         <beforeEveryPageTurn>
         *                         <beforeEveryParagraphShown>
         *                         <afterEveryThing>
         *                         <afterEveryPageTurn>
         *                         <afterEveryParagraphShown>
         */
        function setBeforeAfterActions (parent) {
            _story.beforeEveryThing          = parent.find('beforeEveryThing').text();
            _story.beforeEveryPageTurn       = parent.find('beforeEveryPageTurn').text();
            _story.beforeEveryParagraphShown = parent.find('beforeEveryParagraphShown').text();
            _story.afterEveryThing           = parent.find('afterEveryThing').text();
            _story.afterEveryPageTurn        = parent.find('afterEveryPageTurn').text();
            _story.afterEveryParagraphShown  = parent.find('afterEveryParagraphShown').text();
        }

        // If the story is in dadlee format, first convert it into the normal
        // HTML-like format
        if (this.dedleeSource) {
            this.parseDedlee(this.dedleeSource, this.domSource);
        }

        // Make a temporary copy of domSource so that the destructive process
        // of parsing it can be restored
        temporaryDomSourceCopy = this.domSource.children().clone(true);


        // Prepare _story and returns it
        _story.currentPage    = getInitialCurrentPage(this.domSource);
        _story.initialization = getInitScript(this.domSource);
        _story.intro          = getIntroLocal(this.domSource);
        _story.inventory      = getInitialInventory(this.domSource);
        _story.objects        = getObjects(this.domSource);
        _story.pages          = getPages(this.domSource);
        _story.paragraphs     = getParagraphs(this.domSource);
        _story.title          = getTitleLocal(this.domSource);
        setBeforeAfterActions(this.domSource);

        // Restore untouched domSource
        this.domSource.html('').append(temporaryDomSourceCopy);
        return _story;
    };

    /**
     * Generate a dictionary with the public methods of the global "story" object
     * @return {JSON} A dictionary representing the initial "story" variable
     */
    Dedalus.prototype.generateEmptyStory = function () {
        return {
            currentPageIs                : this.currentPageIs.bind(this),
            currentPage                  : this.currentPage.bind(this),
            removeFromInventory          : this.removeFromInventory.bind(this),
            putInInventory               : this.putInInventory.bind(this),
            isInInventory                : this.isInInventory.bind(this),
            getNumTotalActions           : this.getNumTotalActions.bind(this),
            getNumActionsPerformedInPage : this.getNumActionsPerformedInPage.bind(this),
            getNumPagesTurned            : this.getNumPagesTurned.bind(this),
            getNumParagraphsShown        : this.getNumParagraphsShown.bind(this),
            getNumParagraphsShownInPage  : this.getNumParagraphsShownInPage.bind(this),
            turnTo                       : this.turnTo.bind(this),
            disable                      : this.disable.bind(this),
            enable                       : this.enable.bind(this),
            showParagraph                : this.showParagraph.bind(this),
            endGame                      : this.endGame.bind(this)
        };
    };

    /**
     * Main method for the handle of output. Its concrete realization is implementation
     * specific and is delegated to executePrinting()
     * @param  {doT}    content  A doT template function with the contend to display
     * @param  {Bool}   turnPage True if the printing must generate a change of page
     */
    Dedalus.prototype.print = function (content, turnPage) {
        // Saves the current application state before changin it in order to gather
        // data for the undo
        this.storyUndo      = jQuery.extend(true, {}, story);
        this._storyUndo     = jQuery.extend(true, {}, this._story);
        this.afterUndoSave();

        this.executeBeforeEveryThing();

        this.executePrinting(content, turnPage);

        this.executeAfterEveryThing();

        this._story.numTotalActions += 1;
        this._story.numActionsPerformedInPage += 1;
    };

    /**
     * Display a page.
     * @param  {String} target Id of the page to present
     * @param  {Bool}   noTurn Whether the page must generate a page turn. Defauls
     *                         to true
     */
    Dedalus.prototype.turnTo = function (target, noTurn) {
        var isNoTurn    = noTurn || false,
            pageToPrint = this.getPage(target),
            content     = pageToPrint.content;

        this.executeBeforeEveryPageTurn();

        if (!isNoTurn) {
            this.print(content, true);

            // Set current page unless it is the intro page that must be shown
            // only once and right before page.first
            if (target !== 'intro') {
                this.setCurrentPageId(target);
            }
        } else {
            this.print(content);
        }

        this.executeAfterEveryPageTurn();

        // Update counters.
        this._story.numParagraphsShownInPage  =  0;
        this._story.numActionsPerformedInPage =  0;
        this._story.numPagesTurned            += 1;
    };

    /**
     * Display a paragraph.
     * @param  {String} target Id of the paragraph to present
     */
    Dedalus.prototype.showParagraph = function (target) {
        var paragraphToPrint = this.getParagraph(target),
            content          = paragraphToPrint.content;

        this.executeBeforeEveryParagraphShown();

        this.print(content);

        this.executeAfterEveryParagraphShown();

        // Update counters.
        this._story.numParagraphsShown       += 1;
        this._story.numParagraphsShownInPage += 1;
    };

    /**
     * Return the page object with a given id
     * @param  {String} id Id of the page to return
     * @return {JSON}      Page object
     */
    Dedalus.prototype.getPage = function  (id) {
        return this._story.pages[id];
    };

    /**
     * Return the object with a given id. Try to search it within the current
     * page objects array and if not found return the top level one
     * @param  {String} id Id of the object to return
     * @return {JSON}      Object found
     */
    Dedalus.prototype.getObject = function  (id) {
        var maybeObject = this.getCurrentPage().objects[id];

        return maybeObject !== undefined ? maybeObject : this._story.objects[id];
    };

    /**
     * Get the active actions for the given object in a context
     * @param  {String} id Id of the object whose actions are to return
     * @return {JSON}   Dictionary of active actions (see parseStory.getObjects)
     */
    Dedalus.prototype.getActionsForObject = function (id) {
        var action,
            actions = [],
            object  = this.getObject(id);

        // filter actions whose "when" parameter is currently true
        for (action in object.actions) {
            if (object.actions.hasOwnProperty(action)) {
                if (object.actions[action].when()) {
                    actions.push(object.actions[action]);
                }
            }
        }

        return actions;
    };

    /**
     * Return the paragraph with a given id. Try to search it within the current
     * page paragraphs array and if not found return the top level one
     * @param  {String} id Id of the paragraph to return
     * @return {JSON}      Paragraph found
     */
    Dedalus.prototype.getParagraph = function (id) {
        var maybeParagraph = this.getCurrentPage().paragraphs[id];

        return maybeParagraph !== undefined ? maybeParagraph : this._story.paragraphs[id];
    };

    /**
     * Keep track of an ongoind combination action
     */
    Dedalus.prototype.activateCombinationAction = function () {
        this._story.combinationActionInProgress = true;
    };

    /**
     * Stop keeping track of an ongoind combination action
     */
    Dedalus.prototype.disactivateCombinationAction = function () {
        this._story.combinationActionInProgress = false;
    };

    /**
     * Whether a combination action is awaiting for a target
     * @return {Boolean} true if there is a combination action awaiting
     *                        for a target
     */
    Dedalus.prototype.isCombinationAction = function () {
        return this._story.combinationActionInProgress;
    };

    /**
     * Check if the current page is the provided one
     * @param  {String} page Id of the page to check against
     * @return {Bool}        Whether current page id is the given page id
     */
     Dedalus.prototype.currentPageIs = function (page) {
        return this._story.currentPage === page;
    };

    /**
     * Returns the current page's name
     * @return {Bool} page Id of the page currently being viewed
     */

    Dedalus.prototype.currentPage = function () {
        return this._story.currentPage;
    };

    /**
     * Remove an item from the inventory and trigger a "modified invetory" event
     * on the message center
     * @param  {String} object Id of the object to remove
     */
    Dedalus.prototype.removeFromInventory = function (object) {
        var i;

        var index = this._story.inventory.indexOf(object);
        if (index > -1) {
            this._story.inventory.splice(index, 1);
        }

        this.messageCenter.publish('inventory', 'inventoryChanged');
    };

    /**
     * Add an item to the inventory and trigger a "modified invetory" event
     * on the message center
     * @param  {String} object Id of the object to add
     */
    Dedalus.prototype.putInInventory = function (object) {
        this.removeFromInventory(object);
        this._story.inventory.push(object);

        this.messageCenter.publish('inventory', 'inventoryChanged');
    };

    /**
     * Check if an object is currenlty in the inventory
     * @param  {String} object Id of teh object to check the presence of
     * @return {Bool}          Whether the object is in the inventory
     */
    Dedalus.prototype.isInInventory = function (object) {
        return this._story.inventory.indexOf(object) !== -1;
    };

    /**
     * Run the initialization javascript peculiar to the story being executed
     */
    Dedalus.prototype.executeInitialization = function () {
        eval(this._story.initialization);
    };

    /**
     * Return the introductory content of the story
     * @return {String} HTML to be present at startup
     */
    Dedalus.prototype.getIntro = function () {
        return this._story.intro;
    };

    /**
     * Return the stry title
     * @return {String} Story title
     */
    Dedalus.prototype.getTitle = function () {
        return this._story.title;
    };

    /**
     * Return the inventory object
     * @return {JSON} Dictionary with all the objects currently in inventory
     */
    Dedalus.prototype.getInventory = function () {
        return this._story.inventory;
    };

    /**
     * Return the current page id
     * @return {String} Id of the current page
     */
    Dedalus.prototype.getCurrentPageId = function () {
        return this._story.currentPage;
    };

    /**
     * Set the current page
     * @param  {String} id Id of the page wanted as current page
     */
    Dedalus.prototype.setCurrentPageId = function (id) {
        this._story.currentPage = id;
    };

    /**
     * Return the current page object
     * @return {JSON} Page object
     */
    Dedalus.prototype.getCurrentPage = function () {
        return this.getPage(this._story.currentPage);
    };

    /**
     * Return the number of actions (everything that triggered a display action)
     * @return {Integer} Number of actions performed at the current moment
     */
    Dedalus.prototype.getNumTotalActions = function () {
        return this._story.numTotalActions;
    };

    /**
     * Return the number of actions (everything that triggered a display action)
     * since entering the current page
     * @return {Integer} Number of actions performed at the current moment in the
     * current page
     */
    Dedalus.prototype.getNumActionsPerformedInPage = function () {
        return this._story.numActionsPerformedInPage;
    };

    /**
     * Return the total number of pages shown so far
     * @return {Integer} Number of pages shown at the current moment
     */
    Dedalus.prototype.getNumPagesTurned = function () {
        return this._story.numPagesTurned;
    };

    /**
     * Return the total number of paragraphs shown so far
     * @return {Integer} Number of paragraphs shown at the current moment
     */
    Dedalus.prototype.getNumParagraphsShown = function () {
        return this._story.numParagraphsShown;
    };

     /**
     * Return the total number of paragraphs shown from the last page turn
     * @return {Integer} Number of paragraphs shown in the page at the current moment
     */
    Dedalus.prototype.getNumParagraphsShownInPage = function () {
        return this._story.numParagraphsShownInPage;
    };

    /**
     * Reset the page and paragraph counters
     */
    Dedalus.prototype.resetCounters = function () {
        this._story.numPagesTurned            = 0;
        this._story.numParagraphsShown        = 0;
        this._story.numParagraphsShownInPage  = 0;
        this._story.numTotalActions           = 0;
        this._story.numActionsPerformedInPage = 0;
    };

    /**
     * Undo the last issued action. The concrete implementation is delegated to
     * executeUndo()
     */
    Dedalus.prototype.undo  = function () {
        story       = jQuery.extend({}, this.storyUndo);
        this._story = jQuery.extend({}, this._storyUndo);
        this.executeUndo();
    };

    /**
     * Save the current story running state. The concrete implementation is
     * delegated to executeSave
     */
    Dedalus.prototype.save = function () {
        this.executeSave(story, this._story);
    };

    /**
     * Restore the application to the last saved position. The concrete implementation
     * is delegated to executeRestore(). Execute the restore of if there is any
     * save available. The check of save avaibility is implementation specific.
     */
    Dedalus.prototype.restore = function () {
        var savedData   = this.getRestoreData(),
            savedStory  = savedData[0],
            saved_Story = savedData[1];

        if (this.saveAvailable()) {
            // Restores story and _story to the initial state and merges into them
            // the saved stated
            this._story = jQuery.extend(true, this.parseStory(this.options.domSource), saved_Story);
            story       = jQuery.extend(true, this.generateEmptyStory(), savedStory);

            this.executeRestore();
        }

    };

    /**
     * Restart the execution of the story
     */
    Dedalus.prototype.reset = function () {
        this._story = this.parseStory(this.options.domSource);
        story       = this.generateEmptyStory();

        this.executeReset();
    };

    /**
     * If the story defines a <beforeEveryThing> script, execute it
     */
    Dedalus.prototype.executeBeforeEveryThing  = function () {
        eval(this._story.beforeEveryThing);
    };

    /**
     * If the story defines a <beforeEveryPageTurn> script, execute it
     */
    Dedalus.prototype.executeBeforeEveryPageTurn  = function () {
        eval(this._story.beforeEveryPageTurn);
    };

    /**
     * If the story defines a <beforeEveryParagraphShown> script, execute it
     */
    Dedalus.prototype.executeBeforeEveryParagraphShown  = function () {
        eval(this._story.beforeEveryParagraphShown);
    };

    /**
     * If the story defines a <afterEveryThing> script, execute it
     */
    Dedalus.prototype.executeAfterEveryThing  = function () {
        eval(this._story.afterEveryThing);
    };

    /**
     * If the story defines a <afterEveryPageTurn> script, execute it
     */
    Dedalus.prototype.executeAfterEveryPageTurn  = function () {
        eval(this._story.afterEveryPageTurn);
    };

    /**
     * If the story defines a <afterEveryParagraphShown> script, execute it
     */
    Dedalus.prototype.executeAfterEveryParagraphShown  = function () {
        eval(this._story.afterEveryParagraphShown);
    };



    /* ** TO BE CUSTOMIZED BY IMPLEMENTATIONS ** */

    /**
     * Implementation-specific display action
     * @param  {doT}  content  dotT template function whose result must be displayed
     * @param  {Bool} turnPage Whether to turn page before the display. Defaults to false
     */
    Dedalus.prototype.executePrinting = function (content, turnPage) {};

    /**
     * Implementation-specific undo action
     */
    Dedalus.prototype.executeUndo = function () {};

    /**
     * Implementation-specific save action
     * @param  {JSON} story    Dedalus story object to save
     * @param  {JSON} _story   Dedalus _story object to save
     */
    Dedalus.prototype.executeSave = function (story, _story) {};

    /**
     * Check if there is any save state available
     * @return {Bool} Whether there is any saved state available
     */
    Dedalus.prototype.saveAvailable = function () {};

    /**
     * Implementation-specific restore action
     */
    Dedalus.prototype.executeRestore = function () {};

    /**
     * Implementation-specific reset action
     */
    Dedalus.prototype.executeReset = function () {};

    /**
     * Return restored data
     * @return {Array} An array whose first element is the restored from save
     *                 Dedauls story object, and the second is Dedalus _story:
     *                 [story, _story]
     */
    Dedalus.prototype.getRestoreData = function () {};

    /**
     * Implementation specific action executed after the freezing of a state for
     * undoing purposes
     */
    Dedalus.prototype.afterUndoSave = function () {};

    /**
     * Implementation specific method to convert an interactive element (such as
     * "turn to" or "interact with") into a normal text. The process can be
     * restored by Dedalus.prototype.enable()
     * @param  {jQUery} element Link to be disabled
     */
    Dedalus.prototype.disable = function (element) {};

    /**
     * Implementation specific method to revert a previously disabled interactive
     * element (see Dedalus.prototype.enable())
     */
    Dedalus.prototype.enable = function () {};

    /**
     * Implementation specific action executed when the story comes to an end
     */
    Dedalus.prototype.endGame = function () {};

    /**
     * Get the content of a given jQuery element and returns is "as is", without
     * any encoding that may occur with the use of .html() or .text()
     * @param  {jQuery} element jQuery element whose content has to be returned as
     *                          string
     * @return {String}         String with the raw content of element
     */
    Dedalus.getRawContent = function (element) {
        var contents = element.contents(),
            out      = '';

        contents.each(function () {
            out += this.nodeType === 3 ? this.nodeValue : this.outerHTML;
        });

        return out;
    };

    /* ** UTILTY FUNCTIONS ** */


    /**
     * Generate a message dispatcher that implements the Publish/Subscribe pattern
     * @return {JSON} A message center object:
     *                {
     *                    publish     : Function to issue messages
     *                    subscribe   : Function to subscribe to the message center
     *                    unsubscribe : Function to unsubscribe to the message center
     *                }
     */
    function makeMessageCenter () {
        // A dictionary of channel objects:
        //      {
        //          'Channel name': {
        //              'Subscriber name': Function to be called when a message is
        //                                 published to the channel
        //          }
        //      }
        var channels = {};

        /**
         * Called with a functions, agrees to receive notifications when new
         * messages are issued to that channel
         * @param  {String}   channel    Identifier of the channel
         * @param  {String}   subscriber Identifier of the subscriber
         * @param  {Function} callback   Function to be called when a new message
         *                               message is published to the channel
         */
        function subscribe (channel, subscriber, callback) {
            if (!channels.hasOwnProperty(channel)) { channels[channel] = {}; }
            channels[channel][subscriber] = callback;
        }

        /**
         * Removes a subscriber from the channel
         * @param  {String} channel    Identifier of the channel to be removed from
         * @param  {String} subscriber Identifier of the subscriber that wants to
         *                             be removed
         */
        function unsubscribe (channel, subscriber) {
            if (!channels.hasOwnProperty(channel)) { channels[channel] = {}; }
            if (channels[channel].hasOwnProperty(subscriber)) {
                delete channels[channel][subscriber];
            }
        }

        /**
         * Calls the function (passing message) defined by every subscriber that
         * subscribed the channel where the message is issued
         * @param  {String} channel Identifier of the channel where the message
         *                          is published
         * @param  {Object} message Object to pass to the function
         */
        function publish (channel, message) {
            var subscriber;

            if (channels.hasOwnProperty(channel)) {
                for (subscriber in channels[channel]) {
                    if (channels[channel].hasOwnProperty(subscriber)) {
                        channels[channel][subscriber](message);
                    }
                }
            }
        }

        return {
            publish     : publish,
            subscribe   : subscribe,
            unsubscribe : unsubscribe
        };
    }

}());

/**
 * dedalus-web.js v0.9.5
 * 2013, Gustavo Di Pietro
 * Licensed under the GPL license (http://www.gnu.org/licenses/gpl-2.0.html)
**/

/**
 * DedalusWeb is an implementatio on Dedalus (that DedalusWeb depens on) that
 * runs a Dedalus story in a browser
 */

var DedalusWeb;

(function () {
    "use strict";
    /*jslint evil: true, white: true, nomen: true */
    /*global Dedalus, $, jQuery, doT, localStorage*/

    /**
     * DedalusWeb class inheriting from Dedalus
     * @param  {JSON} options A dictionary of configuration options:
     *                            {
     *                                domTarget:         jQuery element that will contain the output
     *                                                   of the running story
     *                                inventoryTarget:   jQuery element that will contain the inventory
     *                                                   items
     *                                titleTarget:       jQuery element that will contain the title
     *                                                   of the story
     *                                interactionTarget: jQuery element that will contain the dynamic
     *                                                   action menu. Should have "position: absolute"
     *                                undoTarget:        jQuery <a> element that, clicked, runs the undo
     *                                                   action
     *                                saveTarget:        jQuery <a> element that, clicked, runs the save
     *                                                   action
     *                                restoreTarget:     jQuery <a> element that, clicked, runs the restore
     *                                                   action
     *                                resetTarget:       jQuery <a> element that, clicked, runs the reset
     *                                                   action
     *                                undoStageTarget:   jQuery element that will contain a temporary copy
     *                                                   of domTarget. Should have "display: none"
     *                            }
     * @return                    A DedalusWeb instance
     */
    DedalusWeb = function (options) {
        var self = this;

        Dedalus.call(this, options);

        this.domTarget         = options.domTarget;
        this.inventoryTarget   = options.inventoryTarget;
        this.titleTarget       = options.titleTarget;
        this.interactionTarget = options.interactionTarget;
        this.undoTarget        = options.undoTarget;
        this.saveTarget        = options.saveTarget;
        this.restoreTarget     = options.restoreTarget;
        this.resetTarget       = options.resetTarget;
        this.undoStageTarget   = options.undoStageTarget;
        this.domTargetParent   = options.domTargetParent;
        this.onPrint           = options.onPrint ? options.onPrint.bind(this) : this.onPrint;

        // Set the utility buttons functionality
        this.undoTarget.on('click', this.undo.bind(this));
        this.saveTarget.on('click', this.save.bind(this));
        this.restoreTarget.on('click', this.restore.bind(this));
        this.resetTarget.on('click', this.reset.bind(this));

        // Set the title
        this.titleTarget.html(this.getTitle());

        // Set the story to its initial state
        this.executeReset();

        // Subscribe to inventory changes
        this.messageCenter.subscribe('inventory', 'dedalusWeb', this.updateInventory.bind(this));

        // Make the interaction menu disappear on body click if there is no combination
        // action awaiting for a parameter
        $('body, html').on('click', function () {
            if(!self.isCombinationAction()) {
                self.interactionTarget.hide();
                self.disactivateCombinationAction();
            }
        });

    };

    DedalusWeb.prototype = new Dedalus();

    /**
     * Convert all the meningful tags (<turn to>, <interact with>, <show paragraph>)
     * withing domTarget into action links
     */
    DedalusWeb.prototype.handleInteractions = function () {
        var self = this;

        /**
         * Convert a target element into a link than, when clicked, runs fn with
         * argument attrib
         * @param  {String}   element Element to convert into <a>
         * @param  {String}   attrib  Attribute to pass to fn
         * @param  {String}   type    object|parapgraph|page added as class to the newly
         *                            created link
         * @param  {Function} fn      Function to be executed when the newly created
         *                            link is clicked
         */
        function handle (element, attrib, type, fn) {
            self.domTarget.find(element).each(function () {
                var elem       = $(this),
                    target     = elem.attr(attrib),
                    originalId = elem.attr('id'),
                    elemId     = originalId ? 'data-id="' + elem.attr('id') + '"' : '',
                    targetId   = 'data-target-id="' + target + '"',
                    isDisabled = elem.hasClass('disabled'),
                    text       = elem.text(),
                    link       = $('<a href="#" ' + elemId + ' ' + targetId + '>' + text + '</a>');

                link.on('click', function (e) {
                    fn(target, e);
                    e.stopPropagation();
                    return false;
                });

                link.addClass(type);

                elem.after(link);
                elem.remove();

                // Actually disable a pre-desabled link (has class="disabled"). Must have an id
                if (isDisabled) {
                    self.disable(originalId);
                }

            });
        }

        // Convert <turn to> (turn page action)
        handle('turn', 'to', 'page', function (target) {
            self.turnTo(target);
            self.interactionTarget.hide();
        });

        // Convert <interact with> (object or character action)
        handle('interact', 'with', 'object', function (target, e) {
            self.interactWith(target, e);
        });

        // Convert <show paragraph> (paragraph element)
        handle('show', 'paragraph', 'paragraph', function (target) {
            self.showParagraph(target);
            self.interactionTarget.hide();
        });
    };

    /**
     * Return the actions available for the interaction with a given object
     * @param  {String}       target Id of the object or character to interact with
     * @param  {jQuery Event} e      Event generated when clicking on the element
     * @return {JSON}                A dictionary with the available actions
     */
    DedalusWeb.prototype.interactWith = function (target, e) {
        var action,
            content, link,
            self           = this,
            object         = this.getObject(target),
            actions        = object.getActiveActions(),
            clickedElement = $(e.target);

        this.interactionTarget.html('<ul></ul>');

        /**
         * Generate a function to be attached to an action menu item that, when
         * clicked, prints cont
         * @param  {JSON} action Dedalus object action to make "onClick" for
         * @return {Function}    The function to be called on object click
         */
        function makeOnClick (action) {
            return function () {

                // If the action is of type "use this in combination with something else"
                // set the current combination action and populate interactionTarget
                // with possible candidates (all the objects visible in domTarget and
                // those in the inventory, exluding the object calling the combination
                // action), else execute the action
                if (action.hasWith) {
                    self.activateCombinationAction();
                    self.interactionTarget.html('<ul></ul>');

                    $(self.domTarget).find('a.object').add($(self.inventoryTarget).find('a')).each(function(idx, elem) {
                        var element                  = $(elem),
                            link                     = $(element.prop('outerHTML')),
                            targetId                 = link.attr('data-target-id'),
                            object                   = self.getObject(targetId),
                            elemText                 = link.text(),
                            linkText                 = object.inventoryName || elemText,
                            combinationActionContent = action['with'][targetId] || action.content;

                        // Skip current object, it cannot be associated with itself!
                        if (targetId === target) {
                            return;
                        }

                        // Set the text of the new <a> to inventoryName of the object
                        // or to the current link text
                        link.text(linkText);

                        link.on('click', function () {
                            self.print(combinationActionContent);
                            self.interactionTarget.hide();
                            self.handleInteractions();
                            self.disactivateCombinationAction();
                        });

                        self.interactionTarget.find('ul').append(link);
                        self.interactionTarget.find('ul>a').wrap('<li>');
                    });
                } else {
                    self.print(action.content);
                    self.interactionTarget.hide();
                    self.handleInteractions();
                    self.disactivateCombinationAction();
                }
            };
        }

        for (action in actions) {
            if (actions.hasOwnProperty(action)) {
                content = actions[action].content;
                link    = $('<a href="#" data-target-id="' + target + '">' + action + '</a>');

                link.on('click', makeOnClick(actions[action]));

                // Create the <a> within a <li> within the target <ul>
                this.interactionTarget.find('ul').append(link);
                this.interactionTarget.find('ul>a').wrap('<li>');

                // Position teh interaction host element under the clicked link
                // and centered to it
                this.interactionTarget.css('left', clickedElement.offset().left - (this.interactionTarget.width() / 2) + (clickedElement.width() / 2));
                this.interactionTarget.css('top',  clickedElement.offset().top + 20);

                this.interactionTarget.show();
            }
        }

        return actions;
    };

    /**
     * Refresh the inventory host element with the items currently in inventory
     */
    DedalusWeb.prototype.updateInventory = function () {
        var i, link, object, inventoryName,
            self  = this,
            items = this.getInventory();

        this.inventoryTarget.html('<ul></ul>');

        /**
         * Generate a function to be attached to an action menu item that, when
         * clicked, triggers the object action
         * @param  {JSON} obj A story object item
         * @return {Function} The function to be called on object action click
         */
        function makeOnClick (obj) {
            return function (e) {
                self.interactWith(obj, e);
                e.stopPropagation();
                return false;
            };
        }

        for (i = 0; i < items.length; i += 1) {
            object        = this.getObject(items[i]);
            inventoryName = object.inventoryName;
            link          = $('<a href="#" data-target-id="' + items[i] + '">' + inventoryName + '</a>');

            link.on('click', makeOnClick(items[i]));

            // Create the <a> within a <li> within the target <ul>
            this.inventoryTarget.find('ul').append(link);
            this.inventoryTarget.find('ul>a').wrap('<li>');
        }
    };

    DedalusWeb.prototype.executePrinting = function (content, turnPage) {
        var isTurn          = turnPage || false,
            wrappedContent  = '<p>' + content() + '</p>';

        if (!isTurn) {
            if (this.onPrint(wrappedContent, false)) {
                this.domTarget.append(wrappedContent);
            }
        } else {
            if (this.onPrint(wrappedContent, true)) {
                this.domTarget.html(wrappedContent);
            }
        }

        this.handleInteractions();
    };

    DedalusWeb.prototype.executeUndo = function () {
        // Empty domTarget and refill it with the previous state stored in
        // undoStageTarget
        this.domTarget.html('');
        this.undoStageTarget.appendTo(this.domTarget);
        this.updateInventory();
    };

    DedalusWeb.prototype.afterUndoSave = function () {
        // Empty undoStageTarget and refill it with a deep cloned copy of
        // domTarget
        this.undoStageTarget.html('');
        this.undoStageTarget = this.domTarget.children().clone(true);
    };

    DedalusWeb.prototype.executeSave = function (story, _story) {
        // Save story data in localStorage
        localStorage.story  = JSON.stringify(story);
        localStorage._story = JSON.stringify(_story);
    };

    DedalusWeb.prototype.saveAvailable = function () {
        return localStorage.story && localStorage._story;
    };

    DedalusWeb.prototype.getRestoreData = function () {
        return [jQuery.parseJSON(localStorage.story), jQuery.parseJSON(localStorage._story)];
    };

    DedalusWeb.prototype.executeRestore = function () {
        this.updateInventory();
        this.turnTo(this.getCurrentPageId());
    };

    DedalusWeb.prototype.executeReset = function () {
        this.turnTo('intro');
        this.turnTo(this.getCurrentPageId(), true);
        this.resetCounters();
        this.updateInventory();
        this.executeInitialization();

        this.interactionTarget.hide();
    };

    DedalusWeb.prototype.disable = function (id) {
        // Subsitute the matched <a> with a <span> remembering the click function
        var element = this.domTarget.find('a[data-id="' + id + '"]'),
            elementDom,
            spanElement,
            originalClickFn;

        if (element.length > 0) {
            elementDom      = element.get(0),
            spanElement     = '<span data-id="' + id + '">' + element.text() + '</span>',

            // Trick to get the current click event
            // http://stackoverflow.com/questions/2518421/jquery-find-events-handlers-registered-with-an-object
            originalClickFn = $._data(elementDom, 'events').click[0].handler;

            // Make the <a> a <span>
            element.after($(spanElement).data('originalClickFn', originalClickFn));
            element.remove();
        }
    };

    DedalusWeb.prototype.enable = function (id) {
        // Subsitute the matched <span> with a <a> restoring the click function
        var element         = this.domTarget.find('span[data-id="' + id + '"]'),
            aElement        = '<a href="#" data-id="' + id + '">' + element.text() + '</a>',
            originalClickFn = element.data('originalClickFn');

        // Restore original click function
        element.after($(aElement).on('click', originalClickFn));
        element.remove();
    };

    DedalusWeb.prototype.endGame = function () {
        // Disable all the links available in domTarget and inventoryTarget
        this.domTarget.find('a').off('click').contents().unwrap();
        this.inventoryTarget.find('a').off('click').contents().unwrap();
    };

    DedalusWeb.prototype.onPrint = function (content, turn) {
        return true;
    };

}());
