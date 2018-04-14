var lsCoreFormSubmission = false;

/**
 * Stores mappings between LS Card Forms and Spreedly iFrames.
 * @var Object
 */
var lsCardFormFrames = {};


/**
 * Client-side jQuery library for LemonStand
 * Extends jQuery with two methods, `$.getForm` and `$.sendRequest`.
 */
(function ($, window, document) {
  var noop = function () {}
    , popup = function (res) { window.alert(res.message || "Request failed.") }
  function Request ($form, url, handler, opts)
  {
    this.form     = $form
    this.formElement = opts.formElement;
    this.url      = url
    this.handler  = handler
    this.update   = opts.update || {}
    this.redirect = opts.redirect
    this.extraFields = opts.extraFields || {}
    this.isCardForm = $form.hasClass('ls-card-form');
    this.isAddCardForm = $form.hasClass('ls-card-form-add') || $form.hasClass('ls-card-form-checkout-add');
    this.isPayCardForm = $form.hasClass('ls-card-form-pay');
    this.isUpdateCardForm = $form.hasClass('ls-card-form-update');

    // callback handlers
    this.onSuccess = opts.onSuccess || noop
    this.onFailure = opts.onFailure || popup
    this.onAfterUpdate = opts.onAfterUpdate || noop

    this.indicator   = opts.indicator || true
    this.indicatorId = opts.indicatorId
    this.indicatorText = opts.indicatorText
    this.requestEvent = opts.requestEvent
  }

  /**
   * Execute the request
   * @return {[type]} [description]
   */
  Request.prototype.do = function ()
  {
    var e = $.Event('onBeforeAjaxRequest')
    this.form.trigger(e)

    // Don't execute request if prevented.
    if (e.isDefaultPrevented()) {
        return;
    }

    var data = []
      , formData  = this.form.serialize()
      , extraData = $.param(this.extraFields)

    if (formData) data.push(formData)
    if (extraData) data.push(extraData)

    // options object
    var opts = {
      data : data.join('&')
    , type : this.form.attr('method') || 'post'
    , url  : this.url
    , headers: {
        'X-Event-Handler': this.handler
      , 'X-Partials'     : this.partials()
      }
    }

    // call xhr
    $.ajax(opts)
      .done(this.done.bind(this))
      .fail(this.fail.bind(this))

    this.showLoadingIndicator()
  }

  /**
   * done handler
   * @param  {[type]}   res response object
   */
  Request.prototype.done = function (res, status, xhr)
  {
    if (this.isCardForm) {
      $( this.form ).off('LsCardFormTokenized');
      $( this.form ).off('LsCardFormRecached');

      /**
       * Trigger LsCardFormSuccess event.
       */
      $(window).trigger('LsCardFormSuccess', [
          res,
          status,
          xhr,
          this.handler,
          this.form
      ]);
    }

    this.hideLoadingIndicator()

    // redirect client
    var redirect = res.redirect || this.redirect
    if (redirect) return window.location = redirect

    // callback & event
    $('span.error, small.error', this.form).text('');
    $("*[name]", this.form).removeClass("error")

    this.onSuccess(res, status, xhr)
    $(window).trigger('onAjaxSuccess', [res, status, xhr, this.handler, this.form])
    this.form.trigger('onSuccess', [res, status, xhr, this.handler, this.form])

    this.updatePartials(res)
    $(window).trigger('onAjaxAfterUpdate', [res, status, xhr, this.handler, this.form])

    // Resets semaphore at the end of request life.
    if (this.requestEvent && this.requestEvent.type === 'submit') {
        lsCoreFormSubmission = false;
    }
  }

  /**
   * fail handler
   * @param  {[type]} xhr    xhr object
   * @param  {[type]} status Text status
   * @param  {[type]} err    Error
   */
  Request.prototype.fail = function (xhr, status, err)
  {
    var ignoreValidationMessage = false;
    this.hideLoadingIndicator();
    var res = $.parseJSON(xhr.responseText);
    var validationError = res.validationError;

    if (this.isCardForm) {
      $( this.form ).off('LsCardFormTokenized');
      $( this.form ).off('LsCardFormRecached');

      /**
       * Supresses modal throw on validation errors. Backend, 
       * service-level errors should bubble up.
       */
      ignoreValidationMessage = (validationError) ? true : false;

      /**
       * Trigger LsCardFormFail event.
       */
      $(window).trigger('LsCardFormFail', [
          res,
          status,
          xhr,
          this.handler,
          this.form
      ]);
    }

    if (this.isCardForm && validationError) {
      $( this.form ).trigger('LsCardFormValidationErrors', [ JSON.parse(validationError) ]);
    } else { // Handle validation messages for existing forms.
      $('span.error, small.error', this.form).text('');
      $("*[name]", this.form).removeClass("error")
      if (validationError) {
        var valError = JSON.parse(validationError)
        $.each(valError, function(name, val) {
          $('*[name="'+name+'"]', this.form).addClass('error');

           $('*[name="'+name+'"] + span.error, *[name="'+name+'"] + small.error', this.form).text(val);

          var parent = $('*[name="'+name+'"]', this.form).parent()
          if (parent.data('validation-parent') !== undefined)
            $('span.error, small.error', parent).text(val);
        });

        var validationMessage = this.form.data('validation-message');
        if (validationMessage !== undefined) {
          if (validationMessage.length === 0)
            ignoreValidationMessage = true;
          else
            res.message = validationMessage;
        }
      }
    }

    if (!ignoreValidationMessage) {
      this.onFailure(res, status, xhr)
    }

    $('input.error', this.form).first().focus();

    this.form.trigger('onAjaxError', [res, status, xhr, this.handler])

    $(window)
      .trigger("onAfterAjaxError")
      .trigger("onAjaxFailure", [res, status, xhr, this.handler, this.form]);

    // can be specified on ApplicationExceptions
    if (res.redirect) {
        return window.location = res.redirect;
    }

    if (res.reload) {
        res.reload.forEach(function(object) {
            $(object.selector).replaceWith(object.data);
        });
    }

    // Resets semaphore at the end of request life.
    if (this.requestEvent && this.requestEvent.type === 'submit') {
        lsCoreFormSubmission = false;
    }
  }

  Request.prototype.partials = function ()
  {
    var update = this.update
      , partials = []

    for (var i in update) {
      partials.push(update[i])
    }
    return partials.join(',')
  }

  Request.prototype.updatePartials = function (res)
  {
    var update = this.update

    // TODO handle malformed response, handle missing partial
    if ('undefined' === typeof res) return;

    // replace each partial
    for (var i in update) {
      $(i).html(res[update[i]])
          .trigger('onAfterUpdate')
    }

    this.onAfterUpdate(res);
    $(window).trigger('onAfterAjaxUpdate');
  }

  /**
   * Shows the loading indicator.
   * @type   Function
   * @return none
   */
  Request.prototype.showLoadingIndicator = function ()
  {
    if (!this.indicator) return

    var id = this.indicatorId || 'loading-indicator'
      , message = this.indicatorText || 'Loading...'
      , element = $('#' + id)

    if(!element.length) {
      element = $('<div class="ls-loading-indicator" id=' + id + '><span>'+message+'</span></div>')
      $('body').append(element)
    }
    element.show()
  }

  /**
   * Hides the loading indicator.
   * @type Function
   * @return none
   */
  Request.prototype.hideLoadingIndicator = function ()
  {
    if (!this.indicator) return;

    var id = this.indicatorId || "loading-indicator"
      , element = $('#' + id)

    if (element) element.hide()
  }

  /**
   * Helper - gets relevant card form fields for card adds, updates.
   * @type Function
   * @return Object
   */
  Request.prototype.getCardFormFields = function ()
  {
     var request = this;
     var form = this.form;

     /**
     * Get form parameters for tokenization.
     */
    var expiry = $( form ).find('input.expiry')
      .first()
      .val();
    var full_name = $( form ).find('input.full_name')
      .first()
      .val();

    var name = null;
    var month = null;
    var year = null;


    /**
     * Get form parameters for tokenization.
     */
    if (full_name.length > 0) {
      name = full_name;
    }

    /**
     * Checks that expiry matches MM/YYYY pattern.
     */
    if (expiry.match(/\d{2}\/\d{4}/)) {
      expiry = expiry.split('/');
      month = expiry[0];
      year = expiry[1];
    } else if (expiry.match(/^(\d{6})$/)) {
      month = expiry.substring(0, 2);
      year = expiry.substring(2, 6);
    }

    var requiredFields = {
      month: month,
      year: year
    };

    if (name == null) {
      requiredFields.first_name = null;
      requiredFields.last_name = null;
    } else {
      requiredFields.full_name = name;
    }

    /**
     * Adds address fields to tokenization.
     */
    var addressFields = [
      'email',
      'address1',
      'address2',
      'city',
      'state',
      'zip',
      'country',
      'phone_number',
      'company',
      'shipping_address1',
      'shipping_address2',
      'shipping_city',
      'shipping_state',
      'shipping_zip',
      'shipping_country',
      'shipping_phone_number'
    ];

    addressFields.forEach(function( field ) {
      var fieldObj = $( form ).find( '.' + field )
        .first();
      if (fieldObj.val() && fieldObj.val().length > 0) {
        requiredFields[field] = fieldObj.val();
      };
    });

    return requiredFields;
  }



  /**
   * Tokenizes a credit card form + does request on success.
   * @type Function
   * @return none
   */
  Request.prototype.tokenizeCardForm = function ()
  {
    var request = this;
    var form = this.form;
    var fields = this.getCardFormFields();
    var frame = lsCardFormFrames[form.attr('id')];

    frame.tokenizeCreditCard(fields);
  }

  /**
   * Recaches a credit card.
   * @type Function
   * @return none
   */
  Request.prototype.recacheCardForm = function ()
  {
    var request = this;
    var form = this.form;
    var fields = this.getCardFormFields();
    var frame = lsCardFormFrames[form.attr('id')];

    frame.recache();
  }

  /**
   * Walks the DOM tree and returns the closest parent `form` element
   * @api    public
   * @return jQuery
   */
  function getForm () {
    return this.closest('form');
  }

  /**
   * Sends an XMLHttpRequest to LemonStand
   * @api    public
   * @param  String   url     Request destination (optional)
   * @param  String   handler AJAX handler to call on the server
   * @param  Object   options Options to customize the request
   * @return null
   */
  function sendRequest (url, handler, opts) {
    var $form = this.getForm()

    // assume url omitted if only two args provided
    if (!opts) {
      opts    = handler || {}
      handler = url
      url     = $form.attr('action')
    }
    var req = new Request($form, url, handler, opts);

    if (req.isCardForm) {
      if (req.isAddCardForm || req.isPayCardForm) {

        /**
         * Full name - highlights on non-null value.
         */
        $( $form ).on('LsCardFormTokenized', function(event, form, token, paymentMethod) {
          /**
           * Append token to form on submission.
           */
          $( form ).find('input.payment_method_token')
            .attr('value', token);

          /**
           * Does this request after token is set.
           */
          req.do();
        });

        /**
         * Tokenize card form.
         */
        req.tokenizeCardForm();
      }

      if (req.isUpdateCardForm) {
        if (req.formElement.hasClass('delete-button')) {
          req.do();
        } else {
          /**
           * Full name - highlights on non-null value.
           */
          $( $form ).on('LsCardFormRecached', function(event, form, token, paymentMethod) {
            /**
             * Append token to form on submission.
             */
            $( form ).find('input.payment_method_token')
              .attr('value', token);

            /**
             * Does this request after token is set.
             */
            req.do();
          });

          /**
           * Recache card form.
           */
          req.recacheCardForm();
        }
      }

    } else {
      req.do();
    }
  }

  // jQuery plugin
  $.fn.getForm     = getForm
  $.fn.sendRequest = sendRequest
  // load Spreedly.
  $.getScript('https://core.spreedly.com/iframe/iframe-v1.min.js', function() {
    $(window).trigger('onLsCardInit');
  });
})(jQuery, window, document);

/**
 * Initializes LemonStand Card Form.
 * @return void
 */
LsCardForm = function(opts, form)
{
  this.id = $(form).attr('id');
  this.numberId = this.id + '-number';
  this.cvvId = this.id + '-cvv';
  this.form = form;
  this.options = opts;
  this.frame = new SpreedlyPaymentFrame();
  this.frame.init(opts.key, {
      'numberEl': this.numberId,
      'cvvEl': this.cvvId
  });

  /**
   * Loads iFrame event handlers.
   * @return void
   */
  this.loadIFrameEventHandlers = function() {
    var frame = this.frame;
    var cardFormObj = this;
    var opts = this.options;
    var form = this.form;
    var cvvId = this.cvvId;
    var numberId = this.numberId;

    frame.on('ready', function() {
      frame.setPlaceholder('number', (opts.number && opts.number.placeholder) ? opts.number.placeholder : 'Card Number');
      frame.setPlaceholder('cvv', (opts.number && opts.cvv.placeholder) ? opts.cvv.placeholder : 'CVV');
      frame.setStyle('number', (opts.number && opts.number.style) ? opts.number.style : null);
      frame.setStyle('cvv', (opts.cvv && opts.cvv.style) ? opts.cvv.style : null);
      frame.setFieldType('number', 'text');
      frame.setFieldType('cvv', 'text');
      frame.setNumberFormat('prettyFormat');

      /**
       * Set form to run in update mode (if appplicable).
       */
      if (opts.recache && opts.recache.token) {
        frame.setRecache(opts.recache.token, {
            'card_type': opts.recache.card_type,
            'last_four_digits': opts.recache.last_four_digits
        });
      }
    });

    /**
     * Register event handlers on successful form recaching (CVV updates).
     */
    frame.on('recache', function(token, paymentMethod) {
      $( form ).trigger('LsCardFormRecached', [form, token, paymentMethod]);
    });

    /**
     * Card Form Field Event Handlers.
     * Handle form highlights for iFrame fields.
     */
    frame.on('fieldEvent', function(name, type, activeEl, properties) {
      if (type !== 'input') {
        return;
      }

      /**
       * Recache CVV fieldEvents don't send name, type, or activeEl.
       * The logic below infers type from the properties of the given object.
       */
      if (!activeEl) {
        if (properties.cvvLength) {
          activeEl = 'cvv';
          var field = $( form ).find( '#' + cvvId )
          .first();
        }
      } else {
        var field = $( form ).find('.' + activeEl)
          .first();
      }

      /**
       * Add highlight for cvv if valid and not highlighted.
       */
      if (activeEl === 'cvv' && properties.validCvv && !field.hasClass('valid-highlight')) {
        if (field.hasClass('error-highlight')) {
          // Remove error highlight.
          $( field ).removeClass('error-highlight');
          // Remove error text.
          var errorEl = $( form ).find('label[for="' + cvvId + '"] span.error')
            .first();
          $( errorEl ).text('');
        }
        $( field ).addClass('valid-highlight');
      }

      /**
       * Remove cvv highlight if not valid and is highlighted.
       */
      if (activeEl === 'cvv' && !properties.validCvv && field.hasClass('valid-highlight')) {
        $( field ).removeClass('valid-highlight');
        if (properties.cvvLength > 0) {
          $( field ).addClass('error-highlight');
        }
      }

      /**
       * Remove number highlight if not valid and not highlighted.
       */
      if (activeEl === 'number' && properties.validNumber && !field.hasClass('valid-highlight')) {
        if (field.hasClass('error-highlight')) {
          // Remove error highlight.
          $( field ).removeClass('error-highlight');
          // Remove error text.
          var errorEl = $( form ).find('label[for="' + numberId + '"] span.error')
            .first();
          $( errorEl ).text('');
        }
        $( field ).addClass('valid-highlight');
      }

      /**
       * Add highlight for cvv if valid and is highlighted.
       */
      if (activeEl === 'number' && !properties.validNumber && field.hasClass('valid-highlight')) {
        $( field ).removeClass('valid-highlight');
        if (properties.numberLength > 0) {
          $( field ).addClass('error-highlight');
        }
      }
    });

    /**
     * Card Form Error Handlers.
     * Propagate error messages, codes to card form fields.
     */
    frame.on('errors', function(errors) {
        errors.forEach(function(error) {
          if(error.attribute) {

            /**
             * Empty first name, last name cases.
             */
            if ((error.attribute === 'first_name' || error.attribute === 'last_name')) {
              error.attribute = 'full_name';

              if (error.key === 'errors.blank') {
                error.message = 'Name can\'t be blank';
              }
            }

            /**
             * Empty expiry overrides.
             */
            if ((error.attribute === 'month' || error.attribute === 'year')) {
              error.attribute = 'expiry';

              if (error.key === 'errors.blank') {
                error.message = 'Must be MM/YYYY';
              }
            }

            /**
             * Gets form field.
             */
            var field = $( form ).find('.' + error.attribute).first();

            /**
             * Removes form field valid highlight, if set.
             */
            if (field.hasClass('valid-highlight')) {
              $( field ).removeClass('valid-highlight');
            }

            /**
             * Highlights form field.
             */
             $( field ).addClass('error-highlight');

             /**
             * Finds error span within input field's label and adds error message,
             * appends data-error-code.
             */
            var errorEl = $( field ).next('span.error');
            $( errorEl ).text(error.message);
            $( errorEl ).attr('data-error-code', error.key);
          }
        });

        lsCoreFormSubmission = false;
        $( form ).off('LsCardFormTokenized');
        $( form ).off('LsCardFormRecached');
      });

      /**
       * Register event handlers on successful form tokenization.
       */
      frame.on('paymentMethod', function(token, paymentMethod) {
        $( form ).trigger('LsCardFormTokenized', [form, token, paymentMethod]);
      });
  }

  /**
   * jQuery event handlers. Form highlights for non-iFrame fields.
   *
   * Expiry Date - highlights on proper formatting.
   */
  $( form ).find('input.expiry').on('keyup touchend input', function() {
    if ($( this ).val().match(/\d{2}\/\d{4}/) || $( this ).val().match(/^(\d{6})$/)) {
      if ($( this ).hasClass('error-highlight')) {
        // Remove error highlight.
        $( this ).removeClass('error-highlight');
        // Remove error text.
        $( this ).next('span.error').text('');
      }

      if ($( this ).val().match(/^(\d{6})$/)) {
        var expiry = $( this ).val();
        var month = expiry.substring(0, 2);
        var year = expiry.substring(2, 6);
        $( this ).val( month + '/' + year );
      }

      $( this ).addClass('valid-highlight');
    } else {
      $( this ).removeClass('valid-highlight');
    }
  });

  /**
   * Full name - highlights on non-null value.
   */
  $( form ).find('input.full_name').on('keyup touchend input', function() {
    if ($( this ).val().length > 0) {
      if ($( this ).hasClass('error-highlight')) {
        // Remove error highlight.
        $( this ).removeClass('error-highlight');
        // Remove error text.
        $( this ).next('span.error').text('');
      }
      $( this ).addClass('valid-highlight');
    } else {
      $( this ).removeClass('valid-highlight');
    }
  });

  /**
   * Handles, highlights model validation errors in form.
   */
  $( form ).on('LsCardFormValidationErrors', function(event, validation) {
    for (var fieldName in validation) {

      /**
       * Implodes array of messages into space-delimited error message.
       */
      message = validation[fieldName].join(' ');

      var field = $( form ).find('input.' + fieldName)
        .first();

      $( field ).addClass('error-highlight');
      $( field ).next('span.error')
        .text(message);
    }
  });

  this.loadIFrameEventHandlers();
  lsCardFormFrames[this.id] = this.frame;
}

/*
 * LemonStand data attributes: data-ajax-update, data-ajax-extra-fields, data-ajax-redirect, data-ajax-handler
 */
function LSHandleAjaxData(element, ev) {
  var $element = $(element)
    , extraFields = {}
    , update = {}

  if ($element.data('ajax-update')) {
    var idsPartials = $element.data('ajax-update').split(',');

      for (var index in idsPartials) {
        var
          idPartial = idsPartials[index],
          info = idPartial.split('=');

        if (info.length != 2) {
          alert('Invalid AJAX update specifier syntax: ' + idPartial);
          return;
        }

        update[info[0].trim()] = info[1].trim();
      }
  }

  if ($element.data('ajax-extra-fields')) {
    var fieldsValues = $element.data('ajax-extra-fields').split(',');

    for (var index in fieldsValues) {
      var
        fieldValue = fieldsValues[index],
        info = fieldValue.split('=');

      if (info.length != 2) {
        alert('Invalid AJAX extra field specifier syntax: ' + fieldValue);
        return;
      }

      extraFields[info[0].trim()] = info[1].trim().replace(/^'/, '').replace(/'$/, '');
    }
  }

  var options = {'update' : update, 'extraFields' : extraFields, 'requestEvent' : ev};
  if ($element.data('ajax-redirect')) {
    options.redirect = $element.data('ajax-redirect');
  }

  options.formElement = $element;
  $element.sendRequest($element.data('ajax-handler'), options);
}

// Interactive controls (radio buttons, checkboxes, selectors)
$(document).on('change', 'select[data-ajax-handler],input[type=radio][data-ajax-handler],input[type=checkbox][data-ajax-handler],input[type=text][data-ajax-handler]', function (ev) {
  LSHandleAjaxData(this, ev);
});

// Anchor submissions.
$(document).on('click', 'a[data-ajax-handler], input[type=button][data-ajax-handler], input[type="submit"][data-ajax-handler]', function(ev) {
  LSHandleAjaxData(this, ev);
  return false;
});

$(document).on('submit', '[data-ajax-handler]', function(ev) {
   // If form is submitted, and the CMS action is a payment form submission
   // then block subsequent requests until request is at end-of-life.
   if ($(this).data('ajax-handler') === 'shop:onPay') {
       if (lsCoreFormSubmission === false) {
           LSHandleAjaxData(this, ev);
       }
       lsCoreFormSubmission = true;
   } else { // Default behaviour for form submission.
       LSHandleAjaxData(this, ev);
   }
   return false;
});

/*
 * Magical country state list updating. Data attributes: data-state-selector, data-selected-state, data-states-partial
 */
$(document).on('change', '[data-state-selector]', function() {
  var
    stateSelector = $(this).data('state-selector');
    updateList = {};

  var partial = $(this).data('states-partial');
  if (partial === undefined)
    partial = 'shop-stateoptions';

  updateList[stateSelector] = partial;

  $(this).sendRequest('shop:onUpdateStateList', {
      extraFields: {
        country_id: $(this).val(),
        current_state: $(this).data('selected-state')
      },
      update: updateList
  });
});
