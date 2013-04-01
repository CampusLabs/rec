(function () {
  'use strict';

  // Store a local reference to jQuery and Underscorea.
  var $ = window.jQuery;
  var _ = window._;

  var keyDirMap = {'38': 'prev', '40': 'next'};
  var ctrlKeyDirMap = {'80': 'prev', '78': 'next'};

  // Delay a callback `n` ms or invoke immediately if 0.
  var delay = function (cb, n) { return !n ? cb() : _.delay(cb, n); };

  // Direct event bindings to `$el`.
  var directEvents = {
    mouseover: function () { this._hover = true; },
    mouseout: function () {
      this._hover = false;
      _.defer(_.bind(function () {
        if (!this._focus && !this._hover) this.hide();
      }, this));
    }
  };

  // Delegated event bindings to children of `$el`.
  var delegatedEvents = {

    // Delegated events for the input area.
    '.js-rec-input': {

      // Update the `_focus` flag and show the latest query results.
      focus: function (ev) {
        this._focus = true;
        this.query($(ev.currentTarget).val()).show();
      },

      // Check for the up/down keys and enter key, and finally submit a new
      // query.
      keydown: function (ev) {
        var key = ev.which;
        var dir = keyDirMap[key] || (ev.ctrlKey && ctrlKeyDirMap[key]);
        if (dir) {
          this[dir]();
          return ev.preventDefault();
        }
        if (key === 13) {
          var selected = this.$el.find('.js-rec-selected')[0];
          if (selected && selected !== ev.currentTarget) {
            selected.click();
            return ev.preventDefault();
          }
        }
        var $input = $(ev.currentTarget);
        if (key === 27) {
          $input.blur();
          this.hide();
          return ev.preventDefault();
        }
        _.defer(_.bind(function () { this.query($input.val()); }, this));
      },

      // Hide the results when focus is lost.
      blur: function () {
        this._focus = false;
        if (!this._hover) this.hide();
      }
    },

    // Delegated events for invidiual results.
    '.js-rec-selectable': {

      // Select the result that is being hovered over.
      mouseover: function (ev) { this.select($(ev.currentTarget)); },

      // Optionally clear and hide the input and results on result click.
      click: function (ev) {
        var $input = this.$el.find('.js-rec-input');
        if (ev.currentTarget === $input[0]) return;
        if (this.clearOnClick) $input.val('').focus();
        if (this.hideOnClick) {
          $input.blur();
          this.hide();
        }
      }
    }
  };


  // Create the `Rec` constructor.
  //
  // ```js
  // var rec = new Rec('#my-rec-container', {
  //   url: '/search',
  //   template: jst['search-result']
  // });
  // ```
  var Rec = window.Rec = function (el, options) {

    // Define direct and delegated event hashes unique to this instance. This
    // will allow a clean unbinding of these events without worry about any
    // event collisions.
    this._directEvents = {};
    _.each(directEvents, function (cb, key) {
      this._directEvents[key] = _.bind(cb, this);
    }, this);
    this._delegatedEvents = {};
    _.each(delegatedEvents, function (evs, selector) {
      var bound = this._delegatedEvents[selector] = {};
      _.each(evs, function (cb, name) {
        bound[name] = _.bind(cb, this);
      }, this);
    }, this);

    // Create a cache object to store results.
    this._cached = {};

    // Track concurrent fetches for showing/hiding the loading spinner.
    this._fetchQueue = 0;

    // Set the container element.
    this.setElement(el);

    // Extend the instance with its options.
    _.extend(this, options);
  };

  // Define `prototype` properties and methods for `Rec`.
  _.extend(Rec.prototype, {

    // How long since the last keystroke should rec wait to call `fetch`?
    delay: 250,

    // How many results should be displayed? `0` means as many as are returned
    // by `fetch`.
    limit: 0,

    // Should results be cached? Any cross-session caching will need to be
    // handled by your `fetch` method, but in-memory caching is free with rec.
    cache: true,

    // Should the second selectable item be automatically selected? In other
    // words, will hitting return fire the first recommended result or the broad
    // result?
    selectSecond: false,

    // Should the results be hidden and focus blurred when a result is clicked?
    hideOnClick: false,

    // Should the input be cleared when a result is clicked?
    clearOnClick: true,

    // The query string key that will be used with the default `fetch` method.
    queryKey: 'q',

    // Should rec attempt to fetch query results for an empty string?
    fetchNothing: false,

    // Override this template functions to return your labels and results the
    // way you want them. If you are not using the `groupBy` option,
    // `labelTemplate` will be ignored.
    labelTemplate: function (label) { return '<div>' + label + '</div>'; },
    resultTemplate: function (result) { return '<div>' + result + '</div>'; },

    // Parse the query before sending it to `fetch`. This allows you to clean up
    // bad characters, extra spaces, etc...
    parse: function (q) {
      return q.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').toLowerCase();
    },

    // `filter` works alongside `cache` to intelligently predict possible
    // results while waiting for a server request to come back. Override this
    // function with logic that best matches your server's filter logic.
    filter: function (q, result) {
      var str = _.values(result).join(' ').toLowerCase();
      return _.every(q.split(' '), function (w) { return ~str.indexOf(w); });
    },

    // The default `fetch` is designed for simple, JSON AJAX requests. Override
    // thid function to suite your application's needs.
    fetch: function (q, cb) {
      var options = this.fetchOptions || {};
      (options.data || (options.data = {}))[this.queryKey] = q;
      return $.ajax(_.extend({
        type: 'get',
        dataType: 'json',
        success: function (results) { cb(null, results); },
        error: function (xhr) { cb(xhr.responseText); }
      }, options));
    },

    query: function (q) {

      // Parse the raw query string.
      q = this.parse(q);

      // Compare to the last query and store so we don't waste any time.
      if (q === this._lastQ) return this;
      this._lastQ = q;

      // Clear the old `fetch` request if one was about to fire.
      if (this._timeout) {
        clearTimeout(this._timeout);
        this._timeout = null;
        if (!--this._fetchQueue) this.$el.removeClass('js-rec-loading');
      }

      // Looked for a cache result before trying to load.
      if (!this._getCached(q) && (q || this.fetchEmptyQuery)) {

        // Add the loading class.
        ++this._fetchQueue;
        this.$el.addClass('js-rec-loading');

        // Start a timeout to `fetch`
        var self = this;
        this._timeout = delay(function () {
          self._timeout = null;
          self.fetch(q, function (er, results, temp) {
            if (!temp && !--self._fetchQueue) {
              self.$el.removeClass('js-rec-loading');
            }
            self._setCached(q, results);
            self._render();
          });
        }, this.delay);
      }
      return this._render();
    },

    // Set the input element the rec will watch.
    setElement: function (el) {
      if (this.$el) this._unbind();
      this.$el = el instanceof $ ? el : $(el);
      return this._bind();
    },

    show: function () {
      this.$el.addClass('js-rec-active');
      this.select();
      return this;
    },

    hide: function () {
      this.$el.removeClass('js-rec-active');
      return this;
    },

    select: function ($el) {
      this.$el.find('.js-rec-selected').removeClass('js-rec-selected');
      if (!$el) {
        var $selectable = this.$el.find('.js-rec-selectable:visible');
        var i = Math.min(this.selectSecond ? 1 : 0, $selectable.length - 1);
        $el = $selectable.eq(i);
      }
      $el.addClass('js-rec-selected');
      return this;
    },

    _dir: function (step) {
      var $selectable = this.$el.find('.js-rec-selectable:visible');
      var $selected = $selectable.filter('.js-rec-selected');
      var i = _.indexOf($selectable, $selected[0]);
      if (i === -1) return this.select($selectable.first());
      i += step;
      if (i === -1 || i === $selectable.length) return this;
      return this.select($selectable.eq(i));
    },

    prev: function () { this._dir(-1); },

    next: function () { this._dir(1); },

    _getCached: function (q) {
      return this.cache && this._cached[q];
    },

    _setCached: function (q, results) {
      this._cached[q] = results;
      return this;
    },

    _getFiltered: function (q) {
      if (!this.filter) return null;
      var cached;
      for (var i = q.length - 1; i > 0; --i) {
        if (cached = this._getCached(q.slice(0, i))) break;
      }
      if (!cached) return null;
      var filter = _.bind(this.filter, this, q);
      var matches = _.filter(cached, filter);
      return _.size(matches) ? matches : null;
    },


    // Bind (or unbind) delegated events from a multi-level object.
    _bind: function (unbind) {
      var $el = this.$el;
      var method = unbind ? 'off': 'on';
      $el[method](this._directEvents);
      _.each(this._delegatedEvents, function (evs, selector) {
        _.each(evs, function (cb, name) { $el[method](name, selector, cb); });
      });
      return this;
    },

    // Inverse `_bind`.
    _unbind: function () { return this._bind(true); },

    // Build the elements for the most recent query.
    _render: function () {
      var q = this._lastQ;
      var results = this._getCached(q) || this._getFiltered(q);
      this.$el[(q === '' ? 'add' : 'remove') + 'Class']('js-rec-nothing')
        .removeClass('js-rec-no-results')
        .find('.js-rec-result, .js-rec-label').remove();
      if (results) {
        var $results = this.$el.find('.js-rec-results');
        if (results.length) {
          results = this.limit ? _.first(results, this.limit) : results;
          var limit = results.length;
          var count = 0;
          results = _.groupBy(results, this.groupBy || 'undefined');
          _.each(results, function (results, label) {
            if (count === limit) return;
            if (label !== 'undefined') {
              $results.append(this._renderLabel(label));
            }
            _.each(results, function (result) {
              if (count === limit) return;
              $results.append(this._renderResult(result));
              ++count;
            }, this);
          }, this);
        } else {
          this.$el.addClass('js-rec-no-results');
        }
      }
      return this.select();
    },

    _renderLabel: function (label) {
      var el = this.labelTemplate(label);
      return (el instanceof $ ? el : $(el)).addClass('js-rec-label');
    },

    _renderResult: function (result) {
      var el = this.resultTemplate(result);
      return (el instanceof $ ? el : $(el))
        .addClass('js-rec-result js-rec-selectable');
    }
  });
})();
