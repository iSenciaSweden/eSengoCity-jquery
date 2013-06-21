/* Copyright (c) 2013 iSencia AB (http://www.isencia.se/)
 * Licensed under the MIT (LICENSE)
 *
 * Version: 0.1.1
 * Requires jQuery 1.3+
 * Docs: https://github.com/iSenciaSweden/eSengoCity-jquery
 */

(function($){

// default options
var o = {
    entryPoint: null,
    portal:     null,
    space:      null,
    node:       null,
    language:   null,
    timeout:    10,
    cache:      true
};

// true if we have internet connectivity
var connected = true;

// main api entry
$['eSengoCity'] = {

    // set options
    setOptions: function(options) {
        var opt = $.extend({}, o, options);
        o = opt;
    },
    
    // set internet connectivity
    setConnectivity: function(haveInternet) {
        connected = (haveInternet == true);
    },
    
    // list spaces
    listSpaces: function(options) {
        var opt = {
            fullFetch: true,
            requireNode: true
        };
        options = (options === undefined) ? $.extend({}, opt, o) : $.extend({}, o, opt, options);
        return new DataStore('listSpaces', options);
    },
    
    // list categories
    listCategories: function(options) {
        var opt = {
            requireNode: true,
            requireSpace: true
        };
        options = (options === undefined) ? $.extend({}, opt, o) : $.extend({}, o, opt, options);
        return new DataStore('listCategories', options);
    },
    
    // list promotions
    listPromotions: function(options) {
        var opt = {
            requireNode: true,
            requireSpace: true
        };
        options = (options === undefined) ? $.extend({}, opt, o) : $.extend({}, o, opt, options);
        return new DataStore('listPromotions', options);
    },
    
    // custom store
    customStore: function(command, options) {
        options = (options === undefined) ? $.extend({}, o) : $.extend({}, o, options);
        return new DataStore(command, options);
    }

};

// data store class
function DataStore(command, options) {

    var _this = this;

    // options
    var o = {
        pageSize:         8,
        fetchPages:       5,
        cacheTimeout:     20,
        useOldOnError:    true,
        fullFetch:        false,
        prefetch:         true,
        orderBy:          null,
        requireNode:      false,
        requirePortal:    false,
        requireLanguage:  false,
        requireSpace:     false
    };
    
    // remote data state
    var itemCount = 0;
    var pageCount = 0;

    // local data state
    var firstFetch = true;
    var pageFirst = 0;
    /* Pages are stores as objects
     *   items: array of items
     *   created: timestamp when the page was locally created
     */
    var pages = [];
    
    // request counter
    var requestNumber = 0;
    var expected = null;

    // status object
    var dfd_expected = null;

    // set options
    this.setOptions = function(options) {
        var opt = $.extend({}, o, options);
        // fix invalid values
        if (o.pageSize < 1) o.pageSize = 1;
        // detect things that require a reset of local data
        var reset = false;
        if (opt.pageSize != o.pageSize) {
            pageCount = Math.ceil(itemCount / opt.pageSize);
            reset = true;
        }
        if (opt.entryPoint != o.entryPoint) reset = true;
        if (opt.portal != o.portal) reset = true;
        if (opt.space != o.space) reset = true;
        if (opt.language != o.language) reset = true;
        if (opt.orderBy != o.orderBy) reset = true;
        if (opt.fullFetch != o.fullFetch) reset = true;
        // something has changed, reset local data
        if (reset) {
            firstFetch = true;
            pageFirst = 0;
            pages = [];
            if (expected) {
                expected = null;
                dfd_expected.reject('cancel', 'The request was canceled by a newer request.');
            }
        }
        o = opt;
    };
    
    // request a page(s) from the store
    this.getPage = function(pageId, maxPages) {
        var dfd = $.Deferred();
        pageId = (pageId === undefined) ? 0 : +pageId;
        maxPages = (maxPages === undefined) ? 1 : +maxPages;
        // check if we have the pages in cache
        if (this.isPageLoaded(pageId, maxPages)) {
            resolveRequest(dfd, pageId, maxPages);
            // prefetch
            if (o.prefetch && expected === null) {
                if (((pageId + maxPages) < pageCount) && !_this.isPageLoaded(pageId + maxPages) && (pageId + maxPages) < pageCount) {
                    var dummy = $.Deferred();
                    fetchData(dummy, pageId + maxPages, 1);
                }
                else if ((pageId > 0) && !_this.isPageLoaded(pageId - 1)) {
                    var dummy = $.Deferred();
                    fetchData(dummy, pageId - 1, 1);
                }
            }
        }
        // fetch new data
        else fetchData(dfd, pageId, maxPages);
        return dfd;
    };
    
    // get number of items
    this.getItemsCount = function() {
        return itemCount;
    };
    
    // get number of pages
    this.getPagesCount = function() {
        return pageCount;
    };
    
    // get page size
    this.getPageSize = function() {
        return o.pageSize;
    };
    
    // set page size
    this.setPageSize = function(pageSize) {
        this.setOptions({pageSize:pageSize});
    };
    
    // get number of loaded items (it may also include expired items)
    this.getLoadedItemsCount = function() {
        return (pages.length > 0) ? (pages.length - 1) * o.pageSize + pages[pages.length - 1].items.length : 0;
    };
    
    // get number of loaded pages
    this.getLoadedPagesCount = function() {
        return pages.length;
    };
    
    // clear local data
    this.clear = function() {
        firstFetch = true;
        pageFirst = 0;
        pages = [];
    };
    
    // check if page(s) is loaded
    this.isPageLoaded = function(pageId, pageCount, allowOld) {
        pageId = (pageId === undefined || pageId === null) ? 0 : +pageId;
        pageCount = (pageCount === undefined || pageCount === null) ? 1 : +pageCount;
        allowOld = (allowOld === undefined) ? false : allowOld;
        if (pageCount < 1) pageCount = 1;
        if (pageId >= pageFirst) {
            pageId -= pageFirst;
            if ((pageId + pageCount) <= pages.length) {
                var ret = true;
                // make sure all pages are fresh
                if (!allowOld) {
                    var current = +new Date;
                    for (var i = 0; i < pageCount; i++) {
                        if (current > (pages[pageId + i].created + o.cacheTimeout * 60000)) {
                            ret = false;
                            break;
                        }
                    }
                }
                return ret;
            }
        }
        return false;
    };
    
    // "constructor" stuff
    this.setOptions(options);

    // add pages to cache
    function addDataToCache(start, items) {
        if (items.length == 0) return;
        var fetchedPages = Math.ceil(items.length / o.pageSize);
        var newPages = [];
        var oldPageFirst = pageFirst;
        // preserve old data that are before the new
        if (pageFirst < start && (pageFirst + pages.length) >= start) {
            for (var i = pageFirst; i < start; i++) newPages.push(pages[i - pageFirst]);
        }
        else pageFirst = start;
        // add the new pages
        var j = 0;
        for (var i = 0; i < fetchedPages; i++) {
            var entry = {
                items: [],
                created: +new Date
            };
            for (var k = 0; k < o.pageSize; k++) {
                if (j >= items.length) break;
                entry.items.push(items[j++]);
            }
            newPages.push(entry);
        }
        // preserve old pages that are after the new data
        if (oldPageFirst <= (start + fetchedPages) && (oldPageFirst + pages.length) > (start + fetchedPages)) {
            var i = (start + fetchedPages) - oldPageFirst;
            while (i < pages.length) newPages.push(pages[i++]);
        }
        pages = newPages;
    }

    // resolve the fetch request
    function resolveRequest(dfd, startPage, maxPages, fallback) {
        fallback = (fallback === undefined) ? false : fallback;        
        if ((firstFetch || startPage < pageCount) && (((!fallback || !o.useOldOnError) && !_this.isPageLoaded(startPage)) || (fallback && o.useOldOnError && !_this.isPageLoaded(startPage, 1, true)))) {
            dfd.reject('error', 'Could not fetch the wanted data.');
            return;
        }
        var ret = {
            firstPage: startPage,
            pageCount: pageCount,
            pageSize: o.pageSize,
            itemCount: itemCount,
            pages: []
        };
        if (pages.length) {
            startPage -= pageFirst;
            for (var i = 0; i < maxPages; i++) {
                if ((fallback && o.useOldOnError && !_this.isPageLoaded(i + startPage + pageFirst, 1, true)) || ((!fallback || !o.useOldOnError) && !_this.isPageLoaded(i + startPage + pageFirst))) break;
                ret.pages.push(pages[startPage + i]);
            }
        }
        dfd.resolve(ret);
    }

    // do a fetch
    function fetchData(dfd, startPage, maxPages) {
        if ((command === undefined || command === null || command == '' || o.entryPoint === null)
            || (o.requireNode && o.node === null)
            || (o.requirePortal && o.portal === null)
            || (o.requireSpace && o.space === null)
            || (o.requireLanguage && o.language === null)
        ) {
            dfd.reject('argument_missing', 'One or more required arguments are missing.');
            return;
        }
        startPage = (startPage === undefined || startPage === null) ? 0 : +startPage;
        maxPages = (maxPages === undefined || maxPages === null) ? 1 : +maxPages;
        var fullFetch = o.fullFetch;
        var pageSize = o.pageSize;
        // don't even try to fetch, try and handle it as best as we can
        if (!connected) {
            resolveRequest(dfd, startPage, maxPages, true);
            return;
        }
        // build url
        var url = o.entryPoint + encodeURIComponent(command);
        var d = '?';
        if (o.node !== null) {
            url += d + 'node=' + encodeURIComponent(o.node);
            d = '&';
        }
        if (o.language !== null) {
            url += d + 'lang=' + encodeURIComponent(o.language);
            d = '&';
        }
        if (o.portal !== null) {
            url += d + 'portal=' + encodeURIComponent(o.portal);
            d = '&';
        }
        if (o.space !== null) {
            url += d + 'space=' + encodeURIComponent(o.space);
            d = '&';
        }
        // start and max pages arguments
        if (!fullFetch) {
            var realStartPage = startPage;
            var realMaxPages = maxPages;
            // special case for the first fetch
            if (firstFetch || (pages.length == 0 && pageCount > 0)) {
                if ((realStartPage + realMaxPages) <= o.fetchPages) {
                    realStartPage = 0;
                    realMaxPages = o.fetchPages;
                }
            }
            // prefetch
            if (o.prefetch) {
                // fetch one page before
                if ((realStartPage > 0) && !_this.isPageLoaded(realStartPage - 1)) {
                    realStartPage--;
                    realMaxPages++;
                }
                // fetch one extra page after
                if (((realStartPage + realMaxPages) < pageCount) && !_this.isPageLoaded(realStartPage + realMaxPages)) realMaxPages++;
            }
            url += d + 'start=' + realStartPage * pageSize;
            d = '&';
            url += d + 'max=' + realMaxPages * pageSize;
        }
        // ajax fetch
        var id = requestNumber++;
        if (expected !== null) dfd_expected.reject('cancel', 'The request was canceled by a newer request.');
        dfd_expected = dfd;
        expected = id;
        $.ajax({
            url: url,
            cache: o.cache,
            timeout: o.timeout * 1000,
            dataType: 'json'
        }).done(function(data, textStatus, jqXHR){
            var items, total, fetched;
            // array of fetched items
            if ('elements' in data) items = data.elements;
            else items = [];
            // toal size of the remote store
            if ('size' in data) total = +data.size;
            else total = items.length;
            // number of pages returned
            var fetched = Math.ceil(items.length / pageSize);
            // we expected this data
            if (expected === id) {
                expected = null;
                firstFetch = false;
                if (fullFetch && total == items.length) {
                    pageFirst = 0;
                    if (total > 0) {
                        pages = [{
                            items: items,
                            created: +new Date
                        }];
                        pageCount = 1;
                        itemCount = items.length;
                        o.pageSize = itemCount;
                    }
                    else {
                        pages = [];
                        pageCount = 0;
                        itemCount = 0;
                    }
                    resolveRequest(dfd, 0, 1);
                }
                else {
                    // reset local data if remote size has changed
                    if (total != itemCount) {
                        pageFirst = 0;
                        pages = [];
                    }
                    itemCount = total;
                    pageCount = Math.ceil(itemCount / o.pageSize);
                    addDataToCache(realStartPage, items);
                    resolveRequest(dfd, startPage, maxPages);
                }
            }
            // see if we can add it to the cache
            else if (!fullFetch && !o.fullFetch && total == itemCount) {
                addDataToCache(realStartPage, items);
            }
        }).fail(function(jqXHR, textStatus, errorThrown){
            if (expected === id) resolveRequest(dfd, startPage, maxPages, true);
        });
    }
}

})(jQuery);
